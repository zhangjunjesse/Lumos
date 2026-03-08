"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Brain, Loading, Reload } from "@hugeicons/core-free-icons";
import { useTranslation } from "@/hooks/useTranslation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseDBDate } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MasterProfileCard } from "@/components/mind/master-profile-card";

interface MindMetricStats {
  totalMemories: number;
  visibleMemories: number;
  archivedMemories: number;
  projectMemoryCount: number;
  activeProjectsCount: number;
  totalHitCount: number;
}

interface MindMemory {
  id: string;
  scope: string;
  category: string;
  content: string;
  tags: string[];
  source: string;
  projectPath: string;
  projectName: string;
  hitCount: number;
  isPinned?: boolean;
  isArchived?: boolean;
  lastUsedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

interface MindCountItem {
  key: string;
  count: number;
}

interface MindPersonaHistoryItem {
  id: string;
  saved_at: string;
  source: string;
  profile: MindPersonaProfile;
}

type MindWeeklyStoryCode = "quiet" | "steady" | "growing" | "surging";

type MindPersonaProfile = {
  identity: string;
  relationship: string;
  tone: string;
  mission: string;
};

type MindRulesProfile = {
  collaborationStyle: string;
  responseRules: string;
  safetyBoundaries: string;
  memoryPolicy: string;
};

interface MindRulesHistoryItem {
  id: string;
  saved_at: string;
  source: string;
  profile: MindRulesProfile;
}

interface MindMemoryIntelligenceSettings {
  enabled: boolean;
  providerId: string;
  shouldModel: string;
  extractModel: string;
  shouldPrompt: string;
  extractPrompt: string;
  confidenceThreshold: number;
  cooldownSeconds: number;
  dailyBudget: number;
  maxItemsPerRun: number;
  windowMessages: number;
  triggerSessionSwitchEnabled: boolean;
  triggerIdleEnabled: boolean;
  triggerWeakSignalEnabled: boolean;
  idleTimeoutMs: number;
}

interface MindMemoryIntelligenceEvent {
  id: string;
  trigger: string;
  outcome: string;
  reason: string;
  candidateCount: number;
  savedCount: number;
  tokenEstimate: number;
  createdAt: string;
  sessionId: string;
  details: Record<string, unknown>;
}

interface MindMemoryIntelligenceStats {
  recentTriggerCount: number;
  recentSavedRuns: number;
  recentSavedMemories: number;
  recentSkippedRuns: number;
  recentErrors: number;
  recentTokenEstimate: number;
  byTrigger: MindCountItem[];
  byOutcome: MindCountItem[];
}

interface MindSnapshot {
  snapshotAt: string;
  stats: MindMetricStats;
  persona: {
    preferenceSignals: string[];
    boundarySignals: string[];
    workflowSignals: string[];
    dominantTags: Array<{ tag: string; count: number }>;
  };
  personaProfile: MindPersonaProfile;
  personaHistory: MindPersonaHistoryItem[];
  rulesProfile: MindRulesProfile;
  rulesHistory: MindRulesHistoryItem[];
  rules: {
    memorySystemEnabled: boolean;
    projectRulesEnabled: boolean;
    memoryContextMaxItems: number;
    activeProjectPath: string;
    activeProjectName: string;
    claudeMdPath: string;
    claudeMdExists: boolean;
    claudeMdPreview: string;
    rulesDirPath: string;
    rulesFiles: string[];
    hooksDirPath: string;
    hooksFiles: string[];
  };
  runtimePack: {
    sourceOrder: string[];
    sections: Array<{
      key: "persona" | "rules" | "memory";
      title: string;
      enabled: boolean;
      lineCount: number;
      preview: string;
    }>;
    memoryItems: number;
    samplePrompt: string;
    preview: string;
  };
  memoryIntelligence: {
    activeSession: {
      id: string;
      title: string;
      projectPath: string;
    } | null;
    settings: MindMemoryIntelligenceSettings;
    defaults: {
      shouldPrompt: string;
      extractPrompt: string;
    };
    stats: MindMemoryIntelligenceStats;
    recentEvents: MindMemoryIntelligenceEvent[];
  };
  experience: {
    byCategory: MindCountItem[];
    byScope: MindCountItem[];
    bySource: MindCountItem[];
    topReusedMemories: MindMemory[];
  };
  timeline: Array<{
    id: string;
    type: "memory" | "session";
    title: string;
    detail: string;
    time: string;
    category: string;
    scope: string;
    source: string;
    projectPath: string;
    projectName: string;
    state: "active" | "archived";
  }>;
  weeklyDigest: {
    periodStart: string;
    periodEnd: string;
    newMemories: number;
    updatedMemories: number;
    activeDays: number;
    reusedTimes: number;
    topTags: Array<{ tag: string; count: number }>;
    categoryPulse: MindCountItem[];
    storyCode: MindWeeklyStoryCode;
    topCategory: string;
  };
  memories: MindMemory[];
}

const DEFAULT_MEMORY_INTELLIGENCE_SETTINGS: MindMemoryIntelligenceSettings = {
  enabled: true,
  providerId: "",
  shouldModel: "claude-haiku-4-20250514",
  extractModel: "claude-sonnet-4-20250514",
  shouldPrompt: "",
  extractPrompt: "",
  confidenceThreshold: 0.64,
  cooldownSeconds: 300,
  dailyBudget: 24,
  maxItemsPerRun: 3,
  windowMessages: 14,
  triggerSessionSwitchEnabled: true,
  triggerIdleEnabled: true,
  triggerWeakSignalEnabled: true,
  idleTimeoutMs: 120000,
};

const DEFAULT_RULES_PROFILE: MindRulesProfile = {
  collaborationStyle: "",
  responseRules: "",
  safetyBoundaries: "",
  memoryPolicy: "",
};

interface MemoryEditDraft {
  content: string;
  scope: "global" | "project" | "session";
  category: "preference" | "constraint" | "fact" | "workflow" | "other";
  tagsText: string;
  projectPath: string;
}

interface MemoryPatchPayload {
  content?: string;
  scope?: "global" | "project" | "session";
  category?: "preference" | "constraint" | "fact" | "workflow" | "other";
  tags?: string[];
  projectPath?: string;
}

function normalizeMemoryScope(value: string): "global" | "project" | "session" {
  if (value === "project" || value === "session") return value;
  return "global";
}

function normalizeMemoryCategory(value: string): "preference" | "constraint" | "fact" | "workflow" | "other" {
  if (value === "preference" || value === "constraint" || value === "fact" || value === "workflow") return value;
  return "other";
}

function parseTagInput(value: string): string[] {
  const tags = value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(tags)).slice(0, 20);
}

function toReadableDate(value?: string | null): string {
  if (!value) return "-";
  const date = parseDBDate(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function toProjectLabel(projectPath: string): string {
  const normalized = projectPath.replace(/\\/g, "/").trim();
  if (!normalized) return "-";
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function normalizeCompareText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function DistributionList({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: MindCountItem[];
  emptyText: string;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">{emptyText}</p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.key} className="flex items-center justify-between rounded-md border px-2 py-1.5 text-xs">
                <span className="truncate">{item.key}</span>
                <Badge variant="secondary">{item.count}</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function MindPage() {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<MindSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [settingSaving, setSettingSaving] = useState<"" | "memory" | "project">("");
  const [memoryActionId, setMemoryActionId] = useState("");
  const [personaSaving, setPersonaSaving] = useState(false);
  const [personaDirty, setPersonaDirty] = useState(false);
  const [personaDraft, setPersonaDraft] = useState<MindPersonaProfile>({
    identity: "",
    relationship: "",
    tone: "",
    mission: "",
  });
  const [selectedPersonaHistoryId, setSelectedPersonaHistoryId] = useState("");
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesDirty, setRulesDirty] = useState(false);
  const [rulesDraft, setRulesDraft] = useState<MindRulesProfile>(DEFAULT_RULES_PROFILE);
  const [selectedRulesHistoryId, setSelectedRulesHistoryId] = useState("");
  const [memoryDetailId, setMemoryDetailId] = useState("");
  const [memoryStateFilter, setMemoryStateFilter] = useState<"active" | "all" | "archived">("active");
  const [memorySearch, setMemorySearch] = useState("");
  const [memoryCategoryFilter, setMemoryCategoryFilter] = useState("all");
  const [memoryScopeFilter, setMemoryScopeFilter] = useState("all");
  const [timelineTypeFilter, setTimelineTypeFilter] = useState<"all" | "memory" | "session">("all");
  const [timelineProjectFilter, setTimelineProjectFilter] = useState("all");
  const [timelineSearch, setTimelineSearch] = useState("");
  const [memoryEditDraft, setMemoryEditDraft] = useState<MemoryEditDraft>({
    content: "",
    scope: "global",
    category: "other",
    tagsText: "",
    projectPath: "",
  });
  const [intelligenceDraft, setIntelligenceDraft] = useState<MindMemoryIntelligenceSettings>(
    DEFAULT_MEMORY_INTELLIGENCE_SETTINGS,
  );
  const [intelligenceDirty, setIntelligenceDirty] = useState(false);
  const [intelligenceSaving, setIntelligenceSaving] = useState(false);
  const [intelligenceRunning, setIntelligenceRunning] = useState<"" | "run" | "dry">("");
  const [intelligenceFeedback, setIntelligenceFeedback] = useState("");
  const [presetApplying, setPresetApplying] = useState(false);

  const categoryLabels = useMemo(() => ({
    preference: t("mind.memories.categoryPreference"),
    constraint: t("mind.memories.categoryConstraint"),
    fact: t("mind.memories.categoryFact"),
    workflow: t("mind.memories.categoryWorkflow"),
    other: t("mind.memories.categoryOther"),
  }), [t]);

  const categoryHintLabels = useMemo(() => ({
    preference: t("mind.memories.categoryPreferenceHint"),
    constraint: t("mind.memories.categoryConstraintHint"),
    fact: t("mind.memories.categoryFactHint"),
    workflow: t("mind.memories.categoryWorkflowHint"),
    other: t("mind.memories.categoryOtherHint"),
  }), [t]);

  const scopeLabels = useMemo(() => ({
    global: t("mind.memories.scopeGlobal"),
    project: t("mind.memories.scopeProject"),
    session: t("mind.memories.scopeSession"),
  }), [t]);

  const sourceLabel = useCallback((source: string): string => {
    if (source === "user_explicit") return t("mind.memories.sourceUserExplicit");
    if (source.startsWith("llm_")) return t("mind.memories.sourceLlm");
    if (source === "mind_ui") return t("mind.memories.sourceMindUi");
    return source;
  }, [t]);

  const sourceHint = useCallback((source: string): string => {
    if (source === "user_explicit") return t("mind.memories.sourceUserExplicitHint");
    if (source.startsWith("llm_")) return t("mind.memories.sourceLlmHint");
    if (source === "mind_ui") return t("mind.memories.sourceMindUiHint");
    return t("mind.memories.sourceUnknownHint");
  }, [t]);

  const categoryLabel = useCallback((category: string): string => {
    return categoryLabels[category as keyof typeof categoryLabels] || category;
  }, [categoryLabels]);

  const scopeLabel = useCallback((scope: string): string => {
    return scopeLabels[scope as keyof typeof scopeLabels] || scope;
  }, [scopeLabels]);

  const fetchSnapshot = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const includeArchived = memoryStateFilter !== "active";
      const query = includeArchived ? "?includeArchived=true" : "";
      const res = await fetch(`/api/mind${query}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to load mind data");
      }
      const snapshotData = data as MindSnapshot;
      setSnapshot(snapshotData);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load";
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [memoryStateFilter]);

  useEffect(() => {
    fetchSnapshot();
  }, [fetchSnapshot]);

  useEffect(() => {
    if (!snapshot?.personaProfile || personaDirty) return;
    setPersonaDraft(snapshot.personaProfile);
  }, [snapshot?.personaProfile, personaDirty]);

  useEffect(() => {
    if (!snapshot?.rulesProfile || rulesDirty) return;
    setRulesDraft(snapshot.rulesProfile);
  }, [rulesDirty, snapshot?.rulesProfile]);

  useEffect(() => {
    if (!snapshot?.memoryIntelligence?.settings || intelligenceDirty) return;
    setIntelligenceDraft(snapshot.memoryIntelligence.settings);
  }, [snapshot?.memoryIntelligence?.settings, intelligenceDirty]);

  useEffect(() => {
    if (!snapshot?.personaHistory.length) {
      setSelectedPersonaHistoryId("");
      return;
    }
    if (!selectedPersonaHistoryId) {
      setSelectedPersonaHistoryId(snapshot.personaHistory[0].id);
      return;
    }
    if (!snapshot.personaHistory.some((item) => item.id === selectedPersonaHistoryId)) {
      setSelectedPersonaHistoryId(snapshot.personaHistory[0].id);
    }
  }, [snapshot?.personaHistory, selectedPersonaHistoryId]);

  useEffect(() => {
    if (!snapshot?.rulesHistory.length) {
      setSelectedRulesHistoryId("");
      return;
    }
    if (!selectedRulesHistoryId) {
      setSelectedRulesHistoryId(snapshot.rulesHistory[0].id);
      return;
    }
    if (!snapshot.rulesHistory.some((item) => item.id === selectedRulesHistoryId)) {
      setSelectedRulesHistoryId(snapshot.rulesHistory[0].id);
    }
  }, [selectedRulesHistoryId, snapshot?.rulesHistory]);

  const savePersona = useCallback(async (
    profile?: MindPersonaProfile,
    source = "mind_ui",
  ) => {
    const payload = profile || personaDraft;
    setPersonaSaving(true);
    try {
      const res = await fetch("/api/mind/persona", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: payload, source }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to save persona");
      }
      const saved = data?.profile || payload;
      setPersonaDraft(saved);
      setPersonaDirty(false);
      setSnapshot((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          personaProfile: saved,
          personaHistory: Array.isArray(data?.history) ? data.history : prev.personaHistory,
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save persona";
      setError(message);
    } finally {
      setPersonaSaving(false);
    }
  }, [personaDraft]);

  const saveRules = useCallback(async (
    profile?: MindRulesProfile,
    source = "mind_ui",
  ) => {
    const payload = profile || rulesDraft;
    setRulesSaving(true);
    try {
      const res = await fetch("/api/mind/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: payload, source }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to save rules");
      }
      const saved = data?.profile || payload;
      setRulesDraft(saved);
      setRulesDirty(false);
      setSnapshot((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          rulesProfile: saved,
          rulesHistory: Array.isArray(data?.history) ? data.history : prev.rulesHistory,
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save rules";
      setError(message);
    } finally {
      setRulesSaving(false);
    }
  }, [rulesDraft]);

  const restorePersonaDraft = useCallback((item: MindPersonaHistoryItem) => {
    setPersonaDraft(item.profile);
    setPersonaDirty(true);
  }, []);

  const restorePersonaAndSave = useCallback(async (item: MindPersonaHistoryItem) => {
    if (!window.confirm(t("mind.persona.restoreSaveConfirm"))) return;
    setSelectedPersonaHistoryId(item.id);
    await savePersona(item.profile, "mind_history_restore");
  }, [savePersona, t]);

  const restoreRulesDraft = useCallback((item: MindRulesHistoryItem) => {
    setRulesDraft(item.profile);
    setRulesDirty(true);
  }, []);

  const restoreRulesAndSave = useCallback(async (item: MindRulesHistoryItem) => {
    if (!window.confirm(t("mind.persona.restoreSaveConfirm"))) return;
    setSelectedRulesHistoryId(item.id);
    await saveRules(item.profile, "mind_rules_history_restore");
  }, [saveRules, t]);

  const patchMemory = useCallback(async (
    id: string,
    action: "pin" | "unpin" | "archive" | "restore" | "update",
    payload?: MemoryPatchPayload,
  ) => {
    setMemoryActionId(id);
    try {
      const res = await fetch(`/api/mind/memories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(payload || {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to update memory");
      }
      await fetchSnapshot(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update memory";
      setError(message);
    } finally {
      setMemoryActionId("");
    }
  }, [fetchSnapshot]);

  const removeMemory = useCallback(async (id: string) => {
    setMemoryActionId(id);
    try {
      const res = await fetch(`/api/mind/memories/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to delete memory");
      }
      await fetchSnapshot(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete memory";
      setError(message);
    } finally {
      setMemoryActionId("");
    }
  }, [fetchSnapshot]);

  const saveRuleSetting = useCallback(async (settingKey: "memory_system_enabled" | "claude_project_settings_enabled", enabled: boolean) => {
    const savingKey = settingKey === "memory_system_enabled" ? "memory" : "project";
    setSettingSaving(savingKey);
    try {
      const value = settingKey === "memory_system_enabled"
        ? (enabled ? "true" : "false")
        : (enabled ? "true" : "");
      const res = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { [settingKey]: value } }),
      });
      if (!res.ok) {
        throw new Error("Failed to save settings");
      }
      setSnapshot((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          rules: {
            ...prev.rules,
            memorySystemEnabled: settingKey === "memory_system_enabled" ? enabled : prev.rules.memorySystemEnabled,
            projectRulesEnabled: settingKey === "claude_project_settings_enabled" ? enabled : prev.rules.projectRulesEnabled,
          },
        };
      });
      await fetchSnapshot(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      setError(message);
    } finally {
      setSettingSaving("");
    }
  }, [fetchSnapshot]);

  const patchIntelligenceDraft = useCallback((patch: Partial<MindMemoryIntelligenceSettings>) => {
    setIntelligenceDirty(true);
    setIntelligenceDraft((prev) => ({
      ...prev,
      ...patch,
    }));
  }, []);

  const resetIntelligencePrompts = useCallback(() => {
    const defaults = snapshot?.memoryIntelligence?.defaults;
    if (!defaults) return;
    patchIntelligenceDraft({
      shouldPrompt: defaults.shouldPrompt,
      extractPrompt: defaults.extractPrompt,
    });
  }, [patchIntelligenceDraft, snapshot?.memoryIntelligence?.defaults]);

  const saveIntelligenceSettings = useCallback(async () => {
    const normalized: MindMemoryIntelligenceSettings = {
      ...intelligenceDraft,
      confidenceThreshold: Math.max(0.2, Math.min(0.98, Number(intelligenceDraft.confidenceThreshold || 0.64))),
      cooldownSeconds: Math.max(0, Math.min(7200, Math.floor(Number(intelligenceDraft.cooldownSeconds || 300)))),
      dailyBudget: Math.max(1, Math.min(500, Math.floor(Number(intelligenceDraft.dailyBudget || 24)))),
      maxItemsPerRun: Math.max(1, Math.min(8, Math.floor(Number(intelligenceDraft.maxItemsPerRun || 3)))),
      windowMessages: Math.max(4, Math.min(40, Math.floor(Number(intelligenceDraft.windowMessages || 14)))),
      idleTimeoutMs: Math.max(10000, Math.min(600000, Math.floor(Number(intelligenceDraft.idleTimeoutMs || 120000)))),
    };

    setIntelligenceSaving(true);
    setIntelligenceFeedback("");
    try {
      const res = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            memory_intelligence_enabled: normalized.enabled ? "true" : "false",
            memory_intelligence_provider_id: normalized.providerId || "",
            memory_intelligence_should_model: normalized.shouldModel || "",
            memory_intelligence_extract_model: normalized.extractModel || "",
            memory_intelligence_should_prompt: normalized.shouldPrompt || "",
            memory_intelligence_extract_prompt: normalized.extractPrompt || "",
            memory_intelligence_confidence_threshold: String(normalized.confidenceThreshold),
            memory_intelligence_cooldown_seconds: String(normalized.cooldownSeconds),
            memory_intelligence_daily_budget: String(normalized.dailyBudget),
            memory_intelligence_max_items_per_run: String(normalized.maxItemsPerRun),
            memory_intelligence_window_messages: String(normalized.windowMessages),
            memory_intelligence_trigger_session_switch_enabled: normalized.triggerSessionSwitchEnabled ? "true" : "false",
            memory_intelligence_trigger_idle_enabled: normalized.triggerIdleEnabled ? "true" : "false",
            memory_intelligence_trigger_weak_signal_enabled: normalized.triggerWeakSignalEnabled ? "true" : "false",
            memory_intelligence_idle_timeout_ms: String(normalized.idleTimeoutMs),
          },
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to save intelligence settings");
      }
      setIntelligenceDraft(normalized);
      setIntelligenceDirty(false);
      await fetchSnapshot(true);
      setIntelligenceFeedback(t("mind.intelligence.saved"));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save intelligence settings";
      setError(message);
    } finally {
      setIntelligenceSaving(false);
    }
  }, [fetchSnapshot, intelligenceDraft, t]);

  const triggerMemoryIntelligenceNow = useCallback(async (dryRun: boolean) => {
    const sessionId = snapshot?.memoryIntelligence?.activeSession?.id;
    if (!sessionId) {
      setError(t("mind.intelligence.noActiveSession"));
      return;
    }

    setIntelligenceRunning(dryRun ? "dry" : "run");
    setIntelligenceFeedback("");
    try {
      const res = await fetch("/api/memory/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          trigger: "manual",
          force: true,
          dryRun,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to run memory intelligence");
      }
      const result = data?.result;
      setIntelligenceFeedback(t("mind.intelligence.runFeedback", {
        outcome: result?.outcome || "-",
        saved: Number(result?.savedCount || 0),
        reason: result?.reason || "-",
      }));
      if (!dryRun && Number(result?.savedCount || 0) > 0) {
        await fetchSnapshot(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to run memory intelligence";
      setError(message);
    } finally {
      setIntelligenceRunning("");
    }
  }, [fetchSnapshot, snapshot?.memoryIntelligence?.activeSession?.id, t]);

  const applyOpenClawBestPracticePreset = useCallback(async () => {
    setPresetApplying(true);
    setIntelligenceFeedback("");
    try {
      const res = await fetch("/api/memory/presets/openclaw", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to apply preset");
      }
      setIntelligenceDirty(false);
      setRulesDirty(false);
      setPersonaDirty(false);
      await fetchSnapshot(true);
      setIntelligenceFeedback(t("mind.intelligence.appliedBestPractice", {
        model: String(data?.appliedModel || "-"),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to apply preset";
      setError(message);
    } finally {
      setPresetApplying(false);
    }
  }, [fetchSnapshot, t]);

  const stats = snapshot?.stats;
  const hasMemories = (stats?.totalMemories || 0) + (stats?.archivedMemories || 0) > 0;
  const lastUpdatedLabel = useMemo(() => {
    if (!snapshot?.snapshotAt) return "-";
    return toReadableDate(snapshot.snapshotAt);
  }, [snapshot?.snapshotAt]);

  const memoryCategoryOptions = useMemo(() => {
    if (!snapshot) return [];
    return Array.from(new Set(snapshot.memories.map((memory) => memory.category))).sort((a, b) => a.localeCompare(b));
  }, [snapshot]);

  const memoryScopeOptions = useMemo(() => {
    if (!snapshot) return [];
    return Array.from(new Set(snapshot.memories.map((memory) => memory.scope))).sort((a, b) => a.localeCompare(b));
  }, [snapshot]);

  const filteredMemories = useMemo(() => {
    if (!snapshot) return [];
    const keyword = memorySearch.trim().toLowerCase();
    return snapshot.memories.filter((memory) => {
      if (memoryStateFilter === "archived" && !memory.isArchived) return false;
      if (memoryStateFilter === "active" && memory.isArchived) return false;
      if (memoryCategoryFilter !== "all" && memory.category !== memoryCategoryFilter) return false;
      if (memoryScopeFilter !== "all" && memory.scope !== memoryScopeFilter) return false;
      if (!keyword) return true;
      const haystack = [
        memory.content,
        memory.category,
        memory.scope,
        memory.source,
        memory.projectName,
        ...(memory.tags || []),
      ].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }, [snapshot, memorySearch, memoryCategoryFilter, memoryScopeFilter, memoryStateFilter]);

  const timelineProjectOptions = useMemo(() => {
    if (!snapshot) return [];
    return Array.from(new Set(
      snapshot.timeline
        .map((event) => event.projectPath || event.projectName || "")
        .filter(Boolean)
    ))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 50);
  }, [snapshot]);

  const filteredTimeline = useMemo(() => {
    if (!snapshot) return [];
    const keyword = timelineSearch.trim().toLowerCase();
    return snapshot.timeline.filter((event) => {
      if (timelineTypeFilter !== "all" && event.type !== timelineTypeFilter) return false;
      if (
        timelineProjectFilter !== "all"
        && event.projectPath !== timelineProjectFilter
        && event.projectName !== timelineProjectFilter
      ) return false;
      if (!keyword) return true;
      const haystack = `${event.title} ${event.detail} ${event.projectName} ${event.category} ${event.scope} ${event.source}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [snapshot, timelineTypeFilter, timelineProjectFilter, timelineSearch]);

  const selectedPersonaHistory = useMemo(() => {
    if (!snapshot?.personaHistory.length) return null;
    return snapshot.personaHistory.find((item) => item.id === selectedPersonaHistoryId)
      || snapshot.personaHistory[0]
      || null;
  }, [snapshot?.personaHistory, selectedPersonaHistoryId]);

  const selectedRulesHistory = useMemo(() => {
    if (!snapshot?.rulesHistory.length) return null;
    return snapshot.rulesHistory.find((item) => item.id === selectedRulesHistoryId)
      || snapshot.rulesHistory[0]
      || null;
  }, [selectedRulesHistoryId, snapshot?.rulesHistory]);

  const personaCompareItems = useMemo(() => {
    if (!selectedPersonaHistory) return [];
    const candidate = selectedPersonaHistory.profile;
    const fields = [
      { key: "identity", label: t("mind.persona.identity") },
      { key: "relationship", label: t("mind.persona.relationship") },
      { key: "tone", label: t("mind.persona.tone") },
      { key: "mission", label: t("mind.persona.mission") },
    ] as const;
    return fields.map((field) => {
      const historical = candidate[field.key];
      const current = personaDraft[field.key];
      const changed = normalizeCompareText(historical) !== normalizeCompareText(current);
      return {
        key: field.key,
        label: field.label,
        historical,
        current,
        changed,
      };
    });
  }, [personaDraft, selectedPersonaHistory, t]);

  const selectedMemoryDetail = useMemo(() => {
    if (!snapshot || !memoryDetailId) return null;
    return snapshot.memories.find((item) => item.id === memoryDetailId) || null;
  }, [snapshot, memoryDetailId]);

  useEffect(() => {
    if (!selectedMemoryDetail) return;
    setMemoryEditDraft({
      content: selectedMemoryDetail.content || "",
      scope: normalizeMemoryScope(selectedMemoryDetail.scope),
      category: normalizeMemoryCategory(selectedMemoryDetail.category),
      tagsText: (selectedMemoryDetail.tags || []).join(", "),
      projectPath: selectedMemoryDetail.projectPath || "",
    });
  }, [selectedMemoryDetail]);

  const memoryDetailDirty = useMemo(() => {
    if (!selectedMemoryDetail) return false;
    const draftContent = normalizeCompareText(memoryEditDraft.content);
    const draftScope = normalizeMemoryScope(memoryEditDraft.scope);
    const draftCategory = normalizeMemoryCategory(memoryEditDraft.category);
    const draftTags = parseTagInput(memoryEditDraft.tagsText);
    const draftProjectPath = (memoryEditDraft.projectPath || "").trim();

    const sourceContent = normalizeCompareText(selectedMemoryDetail.content || "");
    const sourceScope = normalizeMemoryScope(selectedMemoryDetail.scope);
    const sourceCategory = normalizeMemoryCategory(selectedMemoryDetail.category);
    const sourceTags = parseTagInput((selectedMemoryDetail.tags || []).join(","));
    const sourceProjectPath = (selectedMemoryDetail.projectPath || "").trim();

    const sameTags = draftTags.length === sourceTags.length && draftTags.every((tag, index) => tag === sourceTags[index]);
    const effectiveDraftProjectPath = draftScope === "project" ? draftProjectPath : "";
    const effectiveSourceProjectPath = sourceScope === "project" ? sourceProjectPath : "";

    return (
      draftContent !== sourceContent
      || draftScope !== sourceScope
      || draftCategory !== sourceCategory
      || !sameTags
      || effectiveDraftProjectPath !== effectiveSourceProjectPath
    );
  }, [memoryEditDraft, selectedMemoryDetail]);

  const saveMemoryDetail = useCallback(async () => {
    if (!selectedMemoryDetail) return;
    const content = memoryEditDraft.content.trim();
    const scope = normalizeMemoryScope(memoryEditDraft.scope);
    const category = normalizeMemoryCategory(memoryEditDraft.category);
    const tags = parseTagInput(memoryEditDraft.tagsText);
    const projectPath = (memoryEditDraft.projectPath || "").trim();

    if (!content) {
      setError(t("mind.memories.contentRequired"));
      return;
    }
    if (scope === "project" && !projectPath) {
      setError(t("mind.memories.projectPathRequired"));
      return;
    }

    await patchMemory(selectedMemoryDetail.id, "update", {
      content,
      scope,
      category,
      tags,
      projectPath: scope === "project" ? projectPath : "",
    });
  }, [memoryEditDraft, patchMemory, selectedMemoryDetail, t]);

  useEffect(() => {
    if (memoryCategoryFilter !== "all" && !memoryCategoryOptions.includes(memoryCategoryFilter)) {
      setMemoryCategoryFilter("all");
    }
  }, [memoryCategoryFilter, memoryCategoryOptions]);

  useEffect(() => {
    if (memoryScopeFilter !== "all" && !memoryScopeOptions.includes(memoryScopeFilter)) {
      setMemoryScopeFilter("all");
    }
  }, [memoryScopeFilter, memoryScopeOptions]);

  useEffect(() => {
    if (timelineProjectFilter !== "all" && !timelineProjectOptions.includes(timelineProjectFilter)) {
      setTimelineProjectFilter("all");
    }
  }, [timelineProjectFilter, timelineProjectOptions]);

  useEffect(() => {
    if (!memoryDetailId) return;
    if (!snapshot?.memories.some((memory) => memory.id === memoryDetailId)) {
      setMemoryDetailId("");
    }
  }, [memoryDetailId, snapshot?.memories]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <HugeiconsIcon icon={Loading} className="h-4 w-4 animate-spin" />
        <span>{t("mind.loading")}</span>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-destructive">{error || t("mind.loadError")}</p>
        <Button size="sm" onClick={() => fetchSnapshot()}>
          {t("mind.retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-6xl p-6">
        <div className="mb-6 overflow-hidden rounded-2xl border bg-gradient-to-br from-amber-100/40 via-background to-sky-100/40 p-5 shadow-sm dark:from-amber-950/20 dark:to-sky-950/20">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
                <HugeiconsIcon icon={Brain} className="h-3.5 w-3.5" />
                <span>{t("mind.badge")}</span>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">{t("mind.title")}</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("mind.subtitle")}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("mind.lastUpdated", { time: lastUpdatedLabel })}
              </p>
              {error ? (
                <p className="mt-2 text-xs text-destructive">{error}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/settings">{t("mind.openSettings")}</Link>
              </Button>
              <Button size="sm" variant="outline" onClick={() => fetchSnapshot(true)} disabled={refreshing}>
                <HugeiconsIcon icon={refreshing ? Loading : Reload} className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                {t("mind.refresh")}
              </Button>
            </div>
          </div>
        </div>

        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="gap-0 py-0">
            <CardHeader className="px-4 py-3">
              <CardDescription>{t("mind.metric.totalMemories")}</CardDescription>
              <CardTitle className="text-2xl">{stats?.totalMemories ?? 0}</CardTitle>
              <p className="text-xs text-muted-foreground">{t("mind.metric.activeOnly")}</p>
            </CardHeader>
          </Card>
          <Card className="gap-0 py-0">
            <CardHeader className="px-4 py-3">
              <CardDescription>{t("mind.metric.archivedMemories")}</CardDescription>
              <CardTitle className="text-2xl">{stats?.archivedMemories ?? 0}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {t("mind.metric.visibleMemories", { n: stats?.visibleMemories ?? 0 })}
              </p>
            </CardHeader>
          </Card>
          <Card className="gap-0 py-0">
            <CardHeader className="px-4 py-3">
              <CardDescription>{t("mind.metric.activeProjects")}</CardDescription>
              <CardTitle className="text-2xl">{stats?.activeProjectsCount ?? 0}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {t("mind.metric.projectMemoriesInline", { n: stats?.projectMemoryCount ?? 0 })}
              </p>
            </CardHeader>
          </Card>
          <Card className="gap-0 py-0">
            <CardHeader className="px-4 py-3">
              <CardDescription>{t("mind.metric.reusedTimes")}</CardDescription>
              <CardTitle className="text-2xl">{stats?.totalHitCount ?? 0}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Tabs defaultValue="aboutYou" className="space-y-4">
          <TabsList>
            <TabsTrigger value="aboutYou">{t("mind.tab.aboutYou")}</TabsTrigger>
            <TabsTrigger value="aboutLumos">{t("mind.tab.aboutLumos")}</TabsTrigger>
            <TabsTrigger value="howWeWork">{t("mind.tab.howWeWork")}</TabsTrigger>
          </TabsList>

          <TabsContent value="aboutYou" className="space-y-4">
            <MasterProfileCard understanding={68} />
            <Card>
              <CardHeader>
                <CardTitle>{t("mind.aboutYou.title")}</CardTitle>
                <CardDescription>{t("mind.aboutYou.subtitle")}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{t("mind.aboutYou.empty")}</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="aboutLumos" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t("mind.aboutLumos.title")}</CardTitle>
                <CardDescription>{t("mind.aboutLumos.subtitle")}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">即将推出...</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="howWeWork" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t("mind.howWeWork.title")}</CardTitle>
                <CardDescription>{t("mind.howWeWork.subtitle")}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">即将推出...</p>
              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>

        <Dialog
          open={Boolean(selectedMemoryDetail)}
          onOpenChange={(open) => {
            if (!open) setMemoryDetailId("");
          }}
        >
          <DialogContent className="sm:max-w-2xl">
            {selectedMemoryDetail ? (
              <>
                <DialogHeader>
                  <DialogTitle>{t("mind.memories.detailTitle")}</DialogTitle>
                  <DialogDescription>{t("mind.memories.detailDesc")}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{categoryLabel(selectedMemoryDetail.category)}</Badge>
                    <Badge variant="secondary">{scopeLabel(selectedMemoryDetail.scope)}</Badge>
                    <Badge variant="ghost" title={sourceHint(selectedMemoryDetail.source)}>{sourceLabel(selectedMemoryDetail.source)}</Badge>
                    {selectedMemoryDetail.isArchived ? (
                      <Badge variant="outline">{t("mind.memories.archived")}</Badge>
                    ) : null}
                    {selectedMemoryDetail.isPinned ? (
                      <Badge>{t("mind.memories.pinned")}</Badge>
                    ) : null}
                    {selectedMemoryDetail.projectName ? (
                      <Badge variant="outline">{selectedMemoryDetail.projectName}</Badge>
                    ) : null}
                  </div>
                  <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">{t("mind.memories.editContent")}</p>
                      <Textarea
                        rows={4}
                        value={memoryEditDraft.content}
                        onChange={(e) => setMemoryEditDraft((prev) => ({ ...prev, content: e.target.value }))}
                        placeholder={t("mind.memories.editContentPlaceholder")}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">{t("mind.memories.scope")}</p>
                        <Select
                          value={memoryEditDraft.scope}
                          onValueChange={(value) => {
                            setMemoryEditDraft((prev) => ({
                              ...prev,
                              scope: normalizeMemoryScope(value),
                            }));
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="global">{scopeLabel("global")}</SelectItem>
                            <SelectItem value="project">{scopeLabel("project")}</SelectItem>
                            <SelectItem value="session">{scopeLabel("session")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">{t("mind.memories.category")}</p>
                        <Select
                          value={memoryEditDraft.category}
                          onValueChange={(value) => {
                            setMemoryEditDraft((prev) => ({
                              ...prev,
                              category: normalizeMemoryCategory(value),
                            }));
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="preference">{categoryLabel("preference")}</SelectItem>
                            <SelectItem value="constraint">{categoryLabel("constraint")}</SelectItem>
                            <SelectItem value="fact">{categoryLabel("fact")}</SelectItem>
                            <SelectItem value="workflow">{categoryLabel("workflow")}</SelectItem>
                            <SelectItem value="other">{categoryLabel("other")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">{t("mind.memories.tags")}</p>
                      <Input
                        value={memoryEditDraft.tagsText}
                        onChange={(e) => setMemoryEditDraft((prev) => ({ ...prev, tagsText: e.target.value }))}
                        placeholder={t("mind.memories.tagsPlaceholder")}
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">{t("mind.memories.projectPath")}</p>
                      <Input
                        value={memoryEditDraft.projectPath}
                        onChange={(e) => setMemoryEditDraft((prev) => ({ ...prev, projectPath: e.target.value }))}
                        placeholder={t("mind.memories.projectPathPlaceholder")}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        {memoryEditDraft.scope === "project"
                          ? t("mind.memories.projectPathRequiredHint")
                          : t("mind.memories.projectPathOptionalHint")}
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <div className="rounded-md border px-2 py-1.5">
                      <p>{t("mind.memories.hitCount", { n: selectedMemoryDetail.hitCount })}</p>
                    </div>
                    <div className="rounded-md border px-2 py-1.5">
                      <p>{t("mind.memories.createdAt", { time: toReadableDate(selectedMemoryDetail.createdAt) })}</p>
                    </div>
                    <div className="rounded-md border px-2 py-1.5">
                      <p>{t("mind.memories.updatedAt", { time: toReadableDate(selectedMemoryDetail.updatedAt) })}</p>
                    </div>
                    <div className="rounded-md border px-2 py-1.5">
                      <p>{t("mind.memories.lastUsedAt", { time: toReadableDate(selectedMemoryDetail.lastUsedAt) })}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2 border-t pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={memoryActionId === selectedMemoryDetail.id}
                      onClick={() => patchMemory(selectedMemoryDetail.id, selectedMemoryDetail.isPinned ? "unpin" : "pin")}
                    >
                      {selectedMemoryDetail.isPinned ? t("mind.memories.unpin") : t("mind.memories.pin")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={memoryActionId === selectedMemoryDetail.id}
                      onClick={() => patchMemory(selectedMemoryDetail.id, selectedMemoryDetail.isArchived ? "restore" : "archive")}
                    >
                      {selectedMemoryDetail.isArchived ? t("mind.memories.restore") : t("mind.memories.archive")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={memoryActionId === selectedMemoryDetail.id || !memoryDetailDirty}
                      onClick={saveMemoryDetail}
                    >
                      {t("mind.memories.saveChanges")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={memoryActionId === selectedMemoryDetail.id || !memoryDetailDirty}
                      onClick={() => {
                        setMemoryEditDraft({
                          content: selectedMemoryDetail.content || "",
                          scope: normalizeMemoryScope(selectedMemoryDetail.scope),
                          category: normalizeMemoryCategory(selectedMemoryDetail.category),
                          tagsText: (selectedMemoryDetail.tags || []).join(", "),
                          projectPath: selectedMemoryDetail.projectPath || "",
                        });
                      }}
                    >
                      {t("mind.memories.resetDraft")}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={memoryActionId === selectedMemoryDetail.id}
                      onClick={async () => {
                        if (!window.confirm(t("mind.memories.deleteConfirm"))) return;
                        await removeMemory(selectedMemoryDetail.id);
                        setMemoryDetailId("");
                      }}
                    >
                      {t("mind.memories.delete")}
                    </Button>
                  </div>
                </div>
              </>
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
