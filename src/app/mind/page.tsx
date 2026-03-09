"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  Clock3,
  Heart,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  WandSparkles,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn, parseDBDate } from "@/lib/utils";

type MindDecisionDomain =
  | "engineering"
  | "product"
  | "analysis"
  | "operations"
  | "manufacturing"
  | "family"
  | "education"
  | "other";

type MindQualityCriterion =
  | "accuracy"
  | "actionability"
  | "speed"
  | "risk_control"
  | "experience"
  | "cost"
  | "innovation";

type MindResponseStructure =
  | "conclusion_steps"
  | "option_compare"
  | "teaching_explain"
  | "checklist_execute";

type MindUncertaintyMode =
  | "slow_precise"
  | "estimate_then_verify"
  | "advance_then_calibrate";

type MindCollaborationCadence =
  | "confirm_each_step"
  | "milestone_sync"
  | "final_summary";

type MindCustomCategory =
  | "communication"
  | "decision"
  | "boundary"
  | "trigger"
  | "aesthetic"
  | "industry"
  | "family"
  | "other";

type MindRoleMode = "assistant" | "advisor" | "coach";
type MindProactivityMode = "passive" | "balanced" | "proactive";
type MindChallengeLevel = "compliant" | "gentle" | "strong";
type MindRiskStyle = "conservative" | "balanced" | "aggressive";
type MindMemoryStyle = "strict" | "balanced" | "active";
type MindPolicyCategory = "workflow" | "risk" | "communication" | "memory" | "safety" | "other";

interface MindMemory {
  id: string;
  content: string;
  hitCount: number;
  updatedAt: string;
  isArchived?: boolean;
}

interface MindUserCustomPreference {
  id: string;
  category: MindCustomCategory;
  trigger: string;
  expectedAction: string;
  antiPattern: string;
  priority: number;
  force: boolean;
  enabled: boolean;
}

interface MindUserProfile {
  preferredName: string;
  longTermIdentity: string;
  primaryDecisionDomains: MindDecisionDomain[];
  qualityCriteriaOrder: MindQualityCriterion[];
  responseStructure: MindResponseStructure;
  uncertaintyMode: MindUncertaintyMode;
  collaborationCadence: MindCollaborationCadence;
  hardBoundaries: string[];
  pressureSignals: string[];
  aestheticStandards: string[];
  customPreferences: MindUserCustomPreference[];
}

interface MindUserHistoryItem {
  id: string;
  saved_at: string;
  source: string;
  profile: MindUserProfile;
}

interface MindPersonaCustomPolicy {
  id: string;
  category: MindPolicyCategory;
  trigger: string;
  expectedAction: string;
  antiPattern: string;
  priority: number;
  force: boolean;
  enabled: boolean;
}

interface MindPersonaProfile {
  identity: string;
  relationship: string;
  tone: string;
  mission: string;
  roleMode: MindRoleMode;
  proactivity: MindProactivityMode;
  challengeLevel: MindChallengeLevel;
  riskStyle: MindRiskStyle;
  memoryStyle: MindMemoryStyle;
  customPolicies: MindPersonaCustomPolicy[];
}

interface MindPersonaHistoryItem {
  id: string;
  saved_at: string;
  source: string;
  profile: MindPersonaProfile;
}

interface MindRulesProfile {
  collaborationStyle: string;
  responseRules: string;
  safetyBoundaries: string;
  memoryPolicy: string;
}

interface MindRuntimePackSection {
  key: "user" | "persona" | "rules" | "memory";
  title: string;
  enabled: boolean;
  lineCount: number;
  preview: string;
}

interface MindSnapshot {
  snapshotAt: string;
  userProfile: MindUserProfile;
  userHistory: MindUserHistoryItem[];
  personaProfile: MindPersonaProfile;
  personaHistory: MindPersonaHistoryItem[];
  rulesProfile: MindRulesProfile;
  growth: {
    understandingScore: number;
    consistencyScore: number;
    tacitScore: number;
    stage: "初识" | "熟悉" | "默契" | "共创";
    narrative: string;
  };
  weeklyDigest: {
    periodStart: string;
    periodEnd: string;
    newMemories: number;
    updatedMemories: number;
    activeDays: number;
    reusedTimes: number;
  };
  runtimePack: {
    sections: MindRuntimePackSection[];
    memoryItems: number;
    samplePrompt: string;
  };
  memoryIntelligence: {
    activeSession: { id: string; title: string; projectPath?: string } | null;
  };
  memories: MindMemory[];
}

interface Option<T extends string> {
  value: T;
  label: string;
  hint: string;
}

const DECISION_DOMAIN_OPTIONS: Option<MindDecisionDomain>[] = [
  { value: "engineering", label: "工程开发", hint: "代码、架构、工程效率" },
  { value: "product", label: "产品策略", hint: "需求定义、方案取舍" },
  { value: "analysis", label: "数据分析", hint: "洞察、指标、归因" },
  { value: "operations", label: "运营增长", hint: "转化、留存、策略执行" },
  { value: "manufacturing", label: "制造交付", hint: "流程、质控、交付协同" },
  { value: "family", label: "家庭生活", hint: "家庭事务、陪伴与安排" },
  { value: "education", label: "学习教育", hint: "学习规划、成长路径" },
  { value: "other", label: "其他场景", hint: "可自行扩展" },
];

const QUALITY_CRITERIA_OPTIONS: Option<MindQualityCriterion>[] = [
  { value: "actionability", label: "可执行性", hint: "能立刻落地" },
  { value: "accuracy", label: "准确性", hint: "事实与推理可靠" },
  { value: "experience", label: "体验质量", hint: "表达清晰、结构舒服" },
  { value: "risk_control", label: "风险可控", hint: "风险清晰、可回滚" },
  { value: "speed", label: "响应速度", hint: "尽快推进" },
  { value: "cost", label: "成本效率", hint: "节省时间与资源" },
  { value: "innovation", label: "创新性", hint: "鼓励新想法" },
];

const RESPONSE_STRUCTURE_OPTIONS: Option<MindResponseStructure>[] = [
  { value: "conclusion_steps", label: "先结论后步骤", hint: "先给结论再解释" },
  { value: "option_compare", label: "方案对比后决策", hint: "比较后给建议" },
  { value: "teaching_explain", label: "讲解式推导", hint: "把思路讲明白" },
  { value: "checklist_execute", label: "清单式执行", hint: "按清单逐项完成" },
];

const UNCERTAINTY_MODE_OPTIONS: Option<MindUncertaintyMode>[] = [
  { value: "estimate_then_verify", label: "先估计再校验", hint: "先给判断，再确认" },
  { value: "slow_precise", label: "慢一点但更严谨", hint: "优先稳妥准确" },
  { value: "advance_then_calibrate", label: "先推进后校准", hint: "先动手再迭代" },
];

const CADENCE_OPTIONS: Option<MindCollaborationCadence>[] = [
  { value: "milestone_sync", label: "里程碑同步", hint: "关键节点对齐" },
  { value: "confirm_each_step", label: "每步确认", hint: "每一步先确认" },
  { value: "final_summary", label: "最后汇总", hint: "过程少打扰" },
];

const CUSTOM_CATEGORY_OPTIONS: Option<MindCustomCategory>[] = [
  { value: "communication", label: "沟通表达", hint: "怎么说更舒服" },
  { value: "decision", label: "决策偏好", hint: "怎么做更合拍" },
  { value: "boundary", label: "边界限制", hint: "什么不能做" },
  { value: "trigger", label: "触发场景", hint: "何时要特殊处理" },
  { value: "aesthetic", label: "审美偏好", hint: "风格与品质偏好" },
  { value: "industry", label: "行业语境", hint: "领域内习惯做法" },
  { value: "family", label: "家庭场景", hint: "家人相关场景" },
  { value: "other", label: "其他", hint: "自由扩展" },
];

const ROLE_MODE_OPTIONS: Option<MindRoleMode>[] = [
  { value: "assistant", label: "执行助手", hint: "更多执行、少做判断" },
  { value: "advisor", label: "判断顾问", hint: "给取舍建议与依据" },
  { value: "coach", label: "成长教练", hint: "主动引导长期进步" },
];

const PROACTIVITY_OPTIONS: Option<MindProactivityMode>[] = [
  { value: "passive", label: "按需响应", hint: "你问我答" },
  { value: "balanced", label: "平衡主动", hint: "必要时主动提醒" },
  { value: "proactive", label: "主动推进", hint: "主动提出下一步" },
];

const CHALLENGE_OPTIONS: Option<MindChallengeLevel>[] = [
  { value: "compliant", label: "尽量顺从", hint: "优先执行你的意图" },
  { value: "gentle", label: "温和提醒", hint: "发现问题会提醒" },
  { value: "strong", label: "强提醒与挑战", hint: "必要时直接指出风险" },
];

const RISK_STYLE_OPTIONS: Option<MindRiskStyle>[] = [
  { value: "conservative", label: "稳健保守", hint: "先保底再扩展" },
  { value: "balanced", label: "平衡推进", hint: "收益与风险平衡" },
  { value: "aggressive", label: "激进试探", hint: "允许高收益试错" },
];

const MEMORY_STYLE_OPTIONS: Option<MindMemoryStyle>[] = [
  { value: "strict", label: "严格相关才引用", hint: "只引用高度相关记忆" },
  { value: "balanced", label: "适度引用", hint: "默认平衡注入" },
  { value: "active", label: "主动联想引用", hint: "更积极地联想历史" },
];

const POLICY_CATEGORY_OPTIONS: Option<MindPolicyCategory>[] = [
  { value: "workflow", label: "流程", hint: "流程类策略" },
  { value: "risk", label: "风险", hint: "风险管控策略" },
  { value: "communication", label: "沟通", hint: "沟通表达策略" },
  { value: "memory", label: "记忆", hint: "记忆使用策略" },
  { value: "safety", label: "安全", hint: "安全与边界策略" },
  { value: "other", label: "其他", hint: "自由扩展" },
];

const DEFAULT_USER: MindUserProfile = {
  preferredName: "你",
  longTermIdentity: "长期主义的建设者，重视质量、效率与可持续协作体验。",
  primaryDecisionDomains: ["engineering", "product", "analysis"],
  qualityCriteriaOrder: ["actionability", "accuracy", "experience"],
  responseStructure: "conclusion_steps",
  uncertaintyMode: "estimate_then_verify",
  collaborationCadence: "milestone_sync",
  hardBoundaries: ["不要空泛解释", "不允许伪造执行结果", "风险必须明确提示"],
  pressureSignals: ["为什么总是", "不对", "卡住了"],
  aestheticStandards: ["克制", "清晰", "有层次"],
  customPreferences: [],
};

const DEFAULT_PERSONA: MindPersonaProfile = {
  identity: "Lumos",
  relationship: "长期协作伙伴，持续理解你并减少重复沟通。",
  tone: "温暖、直接、务实；先结论后细节。",
  mission: "在长期协作中把理解沉淀成能力，让每次对话都更默契。",
  roleMode: "advisor",
  proactivity: "balanced",
  challengeLevel: "gentle",
  riskStyle: "balanced",
  memoryStyle: "balanced",
  customPolicies: [],
};

const DEFAULT_RULES: MindRulesProfile = {
  collaborationStyle: "先给可执行结论，再展开关键依据与步骤。",
  responseRules: "回答简洁；信息不足先澄清；复杂任务优先分步推进。",
  safetyBoundaries: "不编造事实，不伪造执行结果，不泄露隐私与密钥。",
  memoryPolicy: "仅在相关时引用记忆；当前轮明确指令始终优先于历史偏好。",
};

function createLocalId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  }
  return `${prefix}_${Math.random().toString(16).slice(2, 14)}`;
}

function toReadableDate(value?: string | null): string {
  if (!value) return "-";
  const date = parseDBDate(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function parseTextList(value: string, maxItems = 10, maxLen = 80): string[] {
  const parts = value
    .split(/[\n,，;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const unique = Array.from(new Set(parts)).slice(0, maxItems);
  return unique.map((item) => item.slice(0, maxLen));
}

function listToText(items: string[]): string {
  return items.join("\n");
}

function scoreColor(value: number): string {
  if (value >= 82) return "bg-emerald-500";
  if (value >= 68) return "bg-sky-500";
  if (value >= 54) return "bg-amber-500";
  return "bg-slate-400";
}

function stageBadgeClass(stage: "初识" | "熟悉" | "默契" | "共创"): string {
  if (stage === "共创") return "border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300";
  if (stage === "默契") return "border-sky-500/30 bg-sky-500/12 text-sky-700 dark:text-sky-300";
  if (stage === "熟悉") return "border-amber-500/30 bg-amber-500/12 text-amber-700 dark:text-amber-300";
  return "border-muted-foreground/30 bg-muted text-muted-foreground";
}

function labelOf<T extends string>(options: Option<T>[], value: T): string {
  return options.find((item) => item.value === value)?.label || value;
}

function GrowthBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="h-2 rounded-full bg-muted">
        <div
          className={`h-2 rounded-full transition-all ${scoreColor(value)}`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

function OptionChip({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={cn(
        "flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition",
        active
          ? "border-foreground/20 bg-accent/45 text-foreground"
          : "border-border/70 bg-background text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      <p className="text-sm font-medium">{label}</p>
      {active ? <Check className="h-3.5 w-3.5 text-foreground/80" /> : null}
    </button>
  );
}

export default function MindPage() {
  const [snapshot, setSnapshot] = useState<MindSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  const [userDraft, setUserDraft] = useState<MindUserProfile>(DEFAULT_USER);
  const [personaDraft, setPersonaDraft] = useState<MindPersonaProfile>(DEFAULT_PERSONA);
  const [rulesDraft, setRulesDraft] = useState<MindRulesProfile>(DEFAULT_RULES);

  const [userListDraft, setUserListDraft] = useState({
    hardBoundaries: listToText(DEFAULT_USER.hardBoundaries),
    pressureSignals: listToText(DEFAULT_USER.pressureSignals),
    aestheticStandards: listToText(DEFAULT_USER.aestheticStandards),
  });

  const [userDirty, setUserDirty] = useState(false);
  const [lumosDirty, setLumosDirty] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [savingLumos, setSavingLumos] = useState(false);
  const [presetApplying, setPresetApplying] = useState(false);
  const [memoryRunning, setMemoryRunning] = useState<"" | "run" | "dry">("");
  const [userEditorOpen, setUserEditorOpen] = useState(false);
  const [lumosEditorOpen, setLumosEditorOpen] = useState(false);
  const [userAdvancedOpen, setUserAdvancedOpen] = useState(false);
  const [userHistoryOpen, setUserHistoryOpen] = useState(false);
  const [personaAdvancedOpen, setPersonaAdvancedOpen] = useState(false);
  const [runtimeDetailsOpen, setRuntimeDetailsOpen] = useState(false);
  const [changeLogOpen, setChangeLogOpen] = useState(false);

  const syncUserListDraft = useCallback((profile: MindUserProfile) => {
    setUserListDraft({
      hardBoundaries: listToText(profile.hardBoundaries || []),
      pressureSignals: listToText(profile.pressureSignals || []),
      aestheticStandards: listToText(profile.aestheticStandards || []),
    });
  }, []);

  const fetchSnapshot = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/mind", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "加载失败");
      const next = data as MindSnapshot;
      setSnapshot(next);
      if (!userDirty) {
        const profile = next.userProfile || DEFAULT_USER;
        setUserDraft(profile);
        syncUserListDraft(profile);
      }
      if (!lumosDirty) {
        setPersonaDraft(next.personaProfile || DEFAULT_PERSONA);
        setRulesDraft(next.rulesProfile || DEFAULT_RULES);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "加载失败";
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [lumosDirty, syncUserListDraft, userDirty]);

  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot]);

  const updateUserField = <K extends keyof MindUserProfile>(field: K, value: MindUserProfile[K]) => {
    setUserDirty(true);
    setUserDraft((prev) => ({ ...prev, [field]: value } as MindUserProfile));
  };

  const updatePersonaField = <K extends keyof MindPersonaProfile>(field: K, value: MindPersonaProfile[K]) => {
    setLumosDirty(true);
    setPersonaDraft((prev) => ({ ...prev, [field]: value } as MindPersonaProfile));
  };

  const updateRulesField = <K extends keyof MindRulesProfile>(field: K, value: MindRulesProfile[K]) => {
    setLumosDirty(true);
    setRulesDraft((prev) => ({ ...prev, [field]: value } as MindRulesProfile));
  };

  const toggleDecisionDomain = (domain: MindDecisionDomain) => {
    if (!userDraft.primaryDecisionDomains.includes(domain) && userDraft.primaryDecisionDomains.length >= 3) {
      setFeedback("核心决策域最多选择 3 项。");
      return;
    }
    setFeedback("");
    setUserDirty(true);
    setUserDraft((prev) => {
      const exists = prev.primaryDecisionDomains.includes(domain);
      return {
        ...prev,
        primaryDecisionDomains: exists
          ? prev.primaryDecisionDomains.filter((item) => item !== domain)
          : [...prev.primaryDecisionDomains, domain],
      };
    });
  };

  const qualityOrder = useMemo(() => {
    const next: MindQualityCriterion[] = [];
    for (const item of userDraft.qualityCriteriaOrder) {
      if (!next.includes(item)) next.push(item);
    }
    for (const option of QUALITY_CRITERIA_OPTIONS) {
      if (next.length >= 3) break;
      if (!next.includes(option.value)) next.push(option.value);
    }
    return next.slice(0, 3);
  }, [userDraft.qualityCriteriaOrder]);

  const updateQualityOrder = (index: number, value: MindQualityCriterion) => {
    setUserDirty(true);
    setUserDraft((prev) => {
      const seed = [...prev.qualityCriteriaOrder];
      seed[index] = value;
      const dedup: MindQualityCriterion[] = [];
      for (const item of seed) {
        if (!item || dedup.includes(item)) continue;
        dedup.push(item);
      }
      for (const option of QUALITY_CRITERIA_OPTIONS) {
        if (dedup.length >= 3) break;
        if (!dedup.includes(option.value)) dedup.push(option.value);
      }
      return { ...prev, qualityCriteriaOrder: dedup.slice(0, 3) };
    });
  };

  const updateUserListField = (
    field: "hardBoundaries" | "pressureSignals" | "aestheticStandards",
    value: string,
    maxItems: number,
    maxLen: number,
  ) => {
    setUserDirty(true);
    setUserListDraft((prev) => ({ ...prev, [field]: value }));
    setUserDraft((prev) => ({ ...prev, [field]: parseTextList(value, maxItems, maxLen) }));
  };

  const addUserCustomPreference = () => {
    setUserDirty(true);
    setUserDraft((prev) => ({
      ...prev,
      customPreferences: [
        ...prev.customPreferences,
        {
          id: createLocalId("up"),
          category: "communication",
          trigger: "",
          expectedAction: "",
          antiPattern: "",
          priority: 3,
          force: false,
          enabled: true,
        },
      ],
    }));
  };

  const updateUserCustomPreference = (id: string, patch: Partial<MindUserCustomPreference>) => {
    setUserDirty(true);
    setUserDraft((prev) => ({
      ...prev,
      customPreferences: prev.customPreferences.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }));
  };

  const removeUserCustomPreference = (id: string) => {
    setUserDirty(true);
    setUserDraft((prev) => ({
      ...prev,
      customPreferences: prev.customPreferences.filter((item) => item.id !== id),
    }));
  };

  const addPersonaCustomPolicy = () => {
    setLumosDirty(true);
    setPersonaDraft((prev) => ({
      ...prev,
      customPolicies: [
        ...prev.customPolicies,
        {
          id: createLocalId("pp"),
          category: "workflow",
          trigger: "",
          expectedAction: "",
          antiPattern: "",
          priority: 3,
          force: false,
          enabled: true,
        },
      ],
    }));
  };

  const updatePersonaCustomPolicy = (id: string, patch: Partial<MindPersonaCustomPolicy>) => {
    setLumosDirty(true);
    setPersonaDraft((prev) => ({
      ...prev,
      customPolicies: prev.customPolicies.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }));
  };

  const removePersonaCustomPolicy = (id: string) => {
    setLumosDirty(true);
    setPersonaDraft((prev) => ({
      ...prev,
      customPolicies: prev.customPolicies.filter((item) => item.id !== id),
    }));
  };

  const saveUserProfile = useCallback(async () => {
    setSavingUser(true);
    setFeedback("");
    try {
      const res = await fetch("/api/mind/user", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: userDraft, source: "mind_ui" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "保存失败");
      const nextProfile = (data?.profile || userDraft) as MindUserProfile;
      setUserDraft(nextProfile);
      syncUserListDraft(nextProfile);
      setUserDirty(false);
      setUserEditorOpen(false);
      setFeedback("已更新“你是谁”。Lumos 会按新的画像与你协作。");
      await fetchSnapshot(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存失败";
      setError(message);
    } finally {
      setSavingUser(false);
    }
  }, [fetchSnapshot, syncUserListDraft, userDraft]);

  const saveLumosProfile = useCallback(async () => {
    setSavingLumos(true);
    setFeedback("");
    try {
      const [personaRes, rulesRes] = await Promise.all([
        fetch("/api/mind/persona", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile: personaDraft, source: "mind_ui" }),
        }),
        fetch("/api/mind/rules", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile: rulesDraft, source: "mind_ui" }),
        }),
      ]);

      const personaData = await personaRes.json();
      const rulesData = await rulesRes.json();
      if (!personaRes.ok) throw new Error(personaData?.error || "保存 Lumos 设定失败");
      if (!rulesRes.ok) throw new Error(rulesData?.error || "保存相处约定失败");

      setLumosDirty(false);
      setLumosEditorOpen(false);
      setFeedback("已更新“我是谁”。Lumos 的行为模式已同步。");
      await fetchSnapshot(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存失败";
      setError(message);
    } finally {
      setSavingLumos(false);
    }
  }, [fetchSnapshot, personaDraft, rulesDraft]);

  const applyBestPracticePreset = useCallback(async () => {
    setPresetApplying(true);
    setFeedback("");
    try {
      const res = await fetch("/api/memory/presets/openclaw", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "应用失败");
      setUserDirty(false);
      setLumosDirty(false);
      await fetchSnapshot(true);
      setFeedback("已应用推荐设定。");
    } catch (err) {
      const message = err instanceof Error ? err.message : "应用失败";
      setError(message);
    } finally {
      setPresetApplying(false);
    }
  }, [fetchSnapshot]);

  const triggerMemory = useCallback(
    async (dryRun: boolean) => {
      const sessionId = snapshot?.memoryIntelligence?.activeSession?.id;
      if (!sessionId) {
        setError("还没有找到正在进行的会话。先聊一轮，我再帮你整理记忆。");
        return;
      }

      setMemoryRunning(dryRun ? "dry" : "run");
      setFeedback("");
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
        if (!res.ok) throw new Error(data?.error || "触发失败");
        const result = data?.result;
        setFeedback(`记忆整理完成：${result?.outcome || "-"}，新增 ${Number(result?.savedCount || 0)} 条。`);
        await fetchSnapshot(true);
      } catch (err) {
        const message = err instanceof Error ? err.message : "触发失败";
        setError(message);
      } finally {
        setMemoryRunning("");
      }
    },
    [fetchSnapshot, snapshot?.memoryIntelligence?.activeSession?.id],
  );

  const archiveMemory = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/mind/memories/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "archive" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "操作失败");
        await fetchSnapshot(true);
      } catch (err) {
        const message = err instanceof Error ? err.message : "操作失败";
        setError(message);
      }
    },
    [fetchSnapshot],
  );

  const growth = snapshot?.growth || {
    understandingScore: 0,
    consistencyScore: 0,
    tacitScore: 0,
    stage: "初识" as const,
    narrative: "还在建立默契中。",
  };

  const weekly = snapshot?.weeklyDigest || {
    periodStart: "",
    periodEnd: "",
    newMemories: 0,
    updatedMemories: 0,
    activeDays: 0,
    reusedTimes: 0,
  };

  const recentMemories = (snapshot?.memories || []).filter((item) => !item.isArchived).slice(0, 8);
  const runtimeSections = snapshot?.runtimePack?.sections || [];
  const enabledRuntimeSections = runtimeSections.filter((item) => item.enabled);
  const userPreferenceCount = userDraft.customPreferences.filter((item) => item.enabled).length;
  const personaPolicyCount = personaDraft.customPolicies.filter((item) => item.enabled).length;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>正在打开“了解彼此”...</span>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-destructive">{error || "加载失败"}</p>
        <Button size="sm" onClick={() => void fetchSnapshot()}>
          重试
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto max-w-5xl px-5 py-6 sm:px-8 sm:py-8">
        <div className="mb-6 rounded-3xl border border-border/70 bg-card p-6 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-background px-3 py-1 text-xs text-muted-foreground">
                <WandSparkles className="h-3.5 w-3.5" />
                <span>了解彼此</span>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">越懂你，越默契</h1>
              <p className="max-w-2xl text-sm text-muted-foreground">只保留关键设定，减少噪音，持续校准你和 Lumos 的协作方式。</p>
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                <span className={`rounded-full border px-2.5 py-1 ${stageBadgeClass(growth.stage)}`}>当前阶段：{growth.stage}</span>
                <span className="rounded-full border border-border/80 bg-background px-2.5 py-1 text-muted-foreground">
                  了解度 {growth.understandingScore}
                </span>
                <span className="rounded-full border border-border/80 bg-background px-2.5 py-1 text-muted-foreground">
                  本周新增记忆 {weekly.newMemories}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">最近更新：{toReadableDate(snapshot.snapshotAt)}</p>
              {error ? <p className="text-xs text-red-500">{error}</p> : null}
              {feedback ? <p className="text-xs text-muted-foreground dark:text-emerald-400">{feedback}</p> : null}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void fetchSnapshot(true)}
              disabled={refreshing}
              className="min-w-[84px]"
            >
              {refreshing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              刷新
            </Button>
          </div>
        </div>

        <Tabs defaultValue="about-you" className="space-y-6">
          <TabsList className="h-auto rounded-xl border border-border/70 bg-card p-1">
            <TabsTrigger value="about-you" className="px-5 py-3 text-sm data-[state=active]:bg-background data-[state=active]:text-foreground">
              你是谁
            </TabsTrigger>
            <TabsTrigger value="about-lumos" className="px-5 py-3 text-sm data-[state=active]:bg-background data-[state=active]:text-foreground">
              我是谁
            </TabsTrigger>
            <TabsTrigger value="together" className="px-5 py-3 text-sm data-[state=active]:bg-background data-[state=active]:text-foreground">
              我们的默契
            </TabsTrigger>
          </TabsList>

          <TabsContent value="about-you" className="space-y-6 animate-in fade-in-50 duration-200">
            <Card className="border-border/70 bg-card shadow-sm">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <UserRound className="h-4 w-4 text-muted-foreground" />
                      Lumos 当前理解的你
                    </CardTitle>
                    <CardDescription>相关场景会自动参考，减少重复沟通。</CardDescription>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      setUserEditorOpen(true);
                    }}
                  >
                    编辑你是谁
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="rounded-2xl border border-border/70 bg-background/45 p-4 text-sm leading-relaxed text-foreground">
                  {userDraft.longTermIdentity}
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl border border-border/70 bg-background/45 p-3">
                    <p className="text-xs text-muted-foreground">称呼偏好</p>
                    <p className="mt-1 text-sm font-medium text-foreground">{userDraft.preferredName || "你"}</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background/45 p-3">
                    <p className="text-xs text-muted-foreground">输出结构</p>
                    <p className="mt-1 text-sm text-foreground">{labelOf(RESPONSE_STRUCTURE_OPTIONS, userDraft.responseStructure)}</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background/45 p-3">
                    <p className="text-xs text-muted-foreground">协作节奏</p>
                    <p className="mt-1 text-sm text-foreground">{labelOf(CADENCE_OPTIONS, userDraft.collaborationCadence)}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">核心决策域</p>
                  <div className="flex flex-wrap gap-2">
                    {userDraft.primaryDecisionDomains.map((item) => (
                      <Badge key={item} variant="secondary">
                        {labelOf(DECISION_DOMAIN_OPTIONS, item)}
                      </Badge>
                    ))}
                    {userDraft.primaryDecisionDomains.length === 0 ? <span className="text-xs text-muted-foreground">未设置</span> : null}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">高压信号</p>
                  <div className="flex flex-wrap gap-2">
                    {userDraft.pressureSignals.map((item) => (
                      <Badge key={item} variant="outline">
                        {item}
                      </Badge>
                    ))}
                    {userDraft.pressureSignals.length === 0 ? <span className="text-xs text-muted-foreground">未设置</span> : null}
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="border-border/70 bg-card shadow-sm">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">扩展偏好</CardTitle>
                      <CardDescription>已启用 {userPreferenceCount} 条。</CardDescription>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setUserAdvancedOpen(true);
                        setUserEditorOpen(true);
                      }}
                    >
                      编辑
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {userDraft.customPreferences.filter((item) => item.enabled).slice(0, 4).map((item) => (
                    <div key={item.id} className="rounded-lg border border-border/70 bg-background/45 px-3 py-2">
                      <p className="truncate text-sm text-foreground">{item.trigger || "未填写触发条件"}</p>
                      <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{item.expectedAction || "未填写期望动作"}</p>
                    </div>
                  ))}
                  {userPreferenceCount === 0 ? <p className="text-sm text-muted-foreground">暂无扩展偏好。</p> : null}
                </CardContent>
              </Card>

              <Card className="border-border/70 bg-card shadow-sm">
                <Collapsible open={userHistoryOpen} onOpenChange={setUserHistoryOpen}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">历史版本</CardTitle>
                        <CardDescription>共 {(snapshot.userHistory || []).length} 条。</CardDescription>
                      </div>
                      <CollapsibleTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground">
                          <ChevronDown className={cn("h-4 w-4 transition-transform", userHistoryOpen ? "rotate-180" : "")} />
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                  </CardHeader>
                  <CollapsibleContent>
                    <CardContent className="space-y-2 pt-0">
                      {(snapshot.userHistory || []).slice(0, 6).map((item) => (
                        <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-foreground">{item.profile.longTermIdentity}</p>
                            <p className="text-xs text-muted-foreground">
                              {toReadableDate(item.saved_at)} · {item.source}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const profile = item.profile || DEFAULT_USER;
                              setUserDraft(profile);
                              syncUserListDraft(profile);
                              setUserDirty(true);
                              setFeedback("已从历史版本恢复为草稿，点击保存后生效。");
                            }}
                          >
                            恢复
                          </Button>
                        </div>
                      ))}
                      {(snapshot.userHistory || []).length === 0 ? <p className="text-sm text-muted-foreground">暂无历史版本。</p> : null}
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            </div>
          </TabsContent>

          <Dialog open={userEditorOpen} onOpenChange={setUserEditorOpen}>
            <DialogContent className="sm:max-w-5xl">
              <DialogHeader>
                <DialogTitle>编辑你是谁</DialogTitle>
                <DialogDescription>修改后会用于后续对话的用户画像参考。</DialogDescription>
              </DialogHeader>
              <div className="max-h-[68vh] space-y-5 overflow-y-auto pr-1">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">1. 我应该怎么称呼你</p>
                  <Input
                    className="h-11 rounded-xl border-border/80 bg-background/45"
                    value={userDraft.preferredName}
                    onChange={(e) => updateUserField("preferredName", e.target.value)}
                    placeholder="例如：Jun / 主人 / 小张"
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">2. 你的长期身份与定位</p>
                  <Textarea
                    className="min-h-[108px] rounded-xl border-border/80 bg-background/45"
                    value={userDraft.longTermIdentity}
                    onChange={(e) => updateUserField("longTermIdentity", e.target.value)}
                    placeholder="例如：长期做复杂决策，希望助手能稳定、克制、可执行。"
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">3. 你的核心决策域（最多 3 个）</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {DECISION_DOMAIN_OPTIONS.map((option) => (
                      <OptionChip
                        key={option.value}
                        active={userDraft.primaryDecisionDomains.includes(option.value)}
                        label={option.label}
                        hint={option.hint}
                        onClick={() => toggleDecisionDomain(option.value)}
                      />
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">4. 你最在意的质量排序（Top 3）</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {[0, 1, 2].map((index) => (
                      <div key={index} className="space-y-1">
                        <p className="text-[11px] text-muted-foreground">第 {index + 1} 优先</p>
                        <Select value={qualityOrder[index]} onValueChange={(value) => updateQualityOrder(index, value as MindQualityCriterion)}>
                          <SelectTrigger className="h-10 w-full rounded-xl border-border/80 bg-background/45">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {QUALITY_CRITERIA_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">5. 默认输出结构</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {RESPONSE_STRUCTURE_OPTIONS.map((option) => (
                      <OptionChip
                        key={option.value}
                        active={userDraft.responseStructure === option.value}
                        label={option.label}
                        hint={option.hint}
                        onClick={() => updateUserField("responseStructure", option.value)}
                      />
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">6. 信息不完整时，我应该怎么做</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {UNCERTAINTY_MODE_OPTIONS.map((option) => (
                      <OptionChip
                        key={option.value}
                        active={userDraft.uncertaintyMode === option.value}
                        label={option.label}
                        hint={option.hint}
                        onClick={() => updateUserField("uncertaintyMode", option.value)}
                      />
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">7. 协作节奏偏好</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {CADENCE_OPTIONS.map((option) => (
                      <OptionChip
                        key={option.value}
                        active={userDraft.collaborationCadence === option.value}
                        label={option.label}
                        hint={option.hint}
                        onClick={() => updateUserField("collaborationCadence", option.value)}
                      />
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">8. 红线 / 高压信号 / 审美标准（每行一条）</p>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">红线（不能做）</p>
                      <Textarea
                        className="min-h-[110px] rounded-xl border-border/80 bg-background/45"
                        value={userListDraft.hardBoundaries}
                        onChange={(e) => updateUserListField("hardBoundaries", e.target.value, 10, 90)}
                        placeholder="例如：不要空泛解释"
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">高压信号（要特别处理）</p>
                      <Textarea
                        className="min-h-[110px] rounded-xl border-border/80 bg-background/45"
                        value={userListDraft.pressureSignals}
                        onChange={(e) => updateUserListField("pressureSignals", e.target.value, 10, 48)}
                        placeholder="例如：不对 / 卡住了"
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">审美标准</p>
                      <Textarea
                        className="min-h-[110px] rounded-xl border-border/80 bg-background/45"
                        value={userListDraft.aestheticStandards}
                        onChange={(e) => updateUserListField("aestheticStandards", e.target.value, 10, 64)}
                        placeholder="例如：克制、清晰、有层次"
                      />
                    </div>
                  </div>
                </div>

                <Collapsible open={userAdvancedOpen} onOpenChange={setUserAdvancedOpen}>
                  <div className="rounded-xl border border-border/70 bg-background/45">
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <div>
                        <p className="text-sm font-medium text-foreground">扩展偏好</p>
                        <p className="text-xs text-muted-foreground">已启用 {userPreferenceCount} 条</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="outline" onClick={addUserCustomPreference}>
                          <Plus className="mr-1.5 h-3.5 w-3.5" />
                          新增
                        </Button>
                        <CollapsibleTrigger asChild>
                          <Button size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground">
                            <ChevronDown className={cn("h-4 w-4 transition-transform", userAdvancedOpen ? "rotate-180" : "")} />
                          </Button>
                        </CollapsibleTrigger>
                      </div>
                    </div>
                    <CollapsibleContent>
                      <div className="space-y-3 px-3 pb-3">
                        {userDraft.customPreferences.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-border/80 bg-background/45 p-3 text-sm text-muted-foreground">暂无扩展偏好。</div>
                        ) : (
                          userDraft.customPreferences.map((item) => (
                            <div key={item.id} className="space-y-3 rounded-xl border border-border/70 bg-background/45 p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <Select
                                  value={item.category}
                                  onValueChange={(value) => updateUserCustomPreference(item.id, { category: value as MindCustomCategory })}
                                >
                                  <SelectTrigger className="h-9 w-[150px] rounded-lg border-border/80 bg-background/45">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {CUSTOM_CATEGORY_OPTIONS.map((option) => (
                                      <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Select
                                  value={String(item.priority)}
                                  onValueChange={(value) => updateUserCustomPreference(item.id, { priority: Number(value) })}
                                >
                                  <SelectTrigger className="h-9 w-[112px] rounded-lg border-border/80 bg-background/45">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {[5, 4, 3, 2, 1].map((value) => (
                                      <SelectItem key={value} value={String(value)}>
                                        优先级 {value}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <label className="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground">
                                  启用
                                  <Switch
                                    checked={item.enabled}
                                    onCheckedChange={(checked) => updateUserCustomPreference(item.id, { enabled: Boolean(checked) })}
                                    size="sm"
                                  />
                                </label>
                                <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                                  强约束
                                  <Switch
                                    checked={item.force}
                                    onCheckedChange={(checked) => updateUserCustomPreference(item.id, { force: Boolean(checked) })}
                                    size="sm"
                                  />
                                </label>
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => removeUserCustomPreference(item.id)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                              <div className="grid gap-2 md:grid-cols-2">
                                <Input
                                  className="h-9 rounded-lg border-border/80 bg-background/45"
                                  value={item.trigger}
                                  onChange={(e) => updateUserCustomPreference(item.id, { trigger: e.target.value })}
                                  placeholder="触发条件"
                                />
                                <Input
                                  className="h-9 rounded-lg border-border/80 bg-background/45"
                                  value={item.antiPattern}
                                  onChange={(e) => updateUserCustomPreference(item.id, { antiPattern: e.target.value })}
                                  placeholder="避免动作（可选）"
                                />
                              </div>
                              <Textarea
                                className="min-h-[96px] rounded-lg border-border/80 bg-background/45"
                                value={item.expectedAction}
                                onChange={(e) => updateUserCustomPreference(item.id, { expectedAction: e.target.value })}
                                placeholder="期望动作"
                              />
                            </div>
                          ))
                        )}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{userDirty ? "有未保存修改" : "已同步"}</p>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setUserEditorOpen(false)}>
                    取消
                  </Button>
                  <Button size="sm" onClick={saveUserProfile} disabled={savingUser}>
                    {savingUser ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                    保存
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <TabsContent value="about-lumos" className="space-y-6 animate-in fade-in-50 duration-200">
            <Card className="border-border/70 bg-card shadow-sm">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Bot className="h-4 w-4 text-muted-foreground" />
                      Lumos 当前设定
                    </CardTitle>
                    <CardDescription>人格、行为模式与协作约定。</CardDescription>
                  </div>
                  <Button size="sm" onClick={() => setLumosEditorOpen(true)}>
                    编辑我是谁
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-border/70 bg-background/45 p-3">
                    <p className="text-xs text-muted-foreground">身份</p>
                    <p className="mt-1 text-sm text-foreground">{personaDraft.identity}</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background/45 p-3">
                    <p className="text-xs text-muted-foreground">关系</p>
                    <p className="mt-1 text-sm text-foreground">{personaDraft.relationship}</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background/45 p-3">
                    <p className="text-xs text-muted-foreground">语气</p>
                    <p className="mt-1 text-sm text-foreground">{personaDraft.tone}</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background/45 p-3">
                    <p className="text-xs text-muted-foreground">使命</p>
                    <p className="mt-1 text-sm text-foreground">{personaDraft.mission}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">行为模式</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{labelOf(ROLE_MODE_OPTIONS, personaDraft.roleMode)}</Badge>
                    <Badge variant="secondary">{labelOf(PROACTIVITY_OPTIONS, personaDraft.proactivity)}</Badge>
                    <Badge variant="secondary">{labelOf(CHALLENGE_OPTIONS, personaDraft.challengeLevel)}</Badge>
                    <Badge variant="secondary">{labelOf(RISK_STYLE_OPTIONS, personaDraft.riskStyle)}</Badge>
                    <Badge variant="secondary">{labelOf(MEMORY_STYLE_OPTIONS, personaDraft.memoryStyle)}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="border-border/70 bg-card shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base">相处约定</CardTitle>
                  <CardDescription>同类问题下保持稳定。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">协作方式</p>
                    <p className="mt-1 text-foreground">{rulesDraft.collaborationStyle}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">回答规则</p>
                    <p className="mt-1 text-foreground">{rulesDraft.responseRules}</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/70 bg-card shadow-sm">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">扩展策略</CardTitle>
                      <CardDescription>已启用 {personaPolicyCount} 条。</CardDescription>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setPersonaAdvancedOpen(true);
                        setLumosEditorOpen(true);
                      }}
                    >
                      编辑
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {personaDraft.customPolicies.filter((item) => item.enabled).slice(0, 4).map((item) => (
                    <div key={item.id} className="rounded-lg border border-border/70 bg-background/45 px-3 py-2">
                      <p className="truncate text-sm text-foreground">{item.trigger || "未填写触发条件"}</p>
                      <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{item.expectedAction || "未填写期望动作"}</p>
                    </div>
                  ))}
                  {personaPolicyCount === 0 ? <p className="text-sm text-muted-foreground">暂无扩展策略。</p> : null}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <Dialog open={lumosEditorOpen} onOpenChange={setLumosEditorOpen}>
            <DialogContent className="sm:max-w-5xl">
              <DialogHeader>
                <DialogTitle>编辑我是谁</DialogTitle>
                <DialogDescription>修改后会影响 Lumos 的行为模式与协作方式。</DialogDescription>
              </DialogHeader>
              <div className="max-h-[68vh] space-y-5 overflow-y-auto pr-1">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">我是谁</p>
                    <Input className="h-11 rounded-xl border-border/80 bg-background/45" value={personaDraft.identity} onChange={(e) => updatePersonaField("identity", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">我的语气</p>
                    <Input className="h-11 rounded-xl border-border/80 bg-background/45" value={personaDraft.tone} onChange={(e) => updatePersonaField("tone", e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">我和你的关系</p>
                  <Textarea className="min-h-[96px] rounded-xl border-border/80 bg-background/45" value={personaDraft.relationship} onChange={(e) => updatePersonaField("relationship", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">我的使命</p>
                  <Textarea className="min-h-[96px] rounded-xl border-border/80 bg-background/45" value={personaDraft.mission} onChange={(e) => updatePersonaField("mission", e.target.value)} />
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">行为模式</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <p className="text-[11px] text-muted-foreground">角色模式</p>
                      <div className="grid gap-2">
                        {ROLE_MODE_OPTIONS.map((option) => (
                          <OptionChip key={option.value} active={personaDraft.roleMode === option.value} label={option.label} hint={option.hint} onClick={() => updatePersonaField("roleMode", option.value)} />
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[11px] text-muted-foreground">主动性</p>
                      <div className="grid gap-2">
                        {PROACTIVITY_OPTIONS.map((option) => (
                          <OptionChip key={option.value} active={personaDraft.proactivity === option.value} label={option.label} hint={option.hint} onClick={() => updatePersonaField("proactivity", option.value)} />
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[11px] text-muted-foreground">挑战强度</p>
                      <div className="grid gap-2">
                        {CHALLENGE_OPTIONS.map((option) => (
                          <OptionChip key={option.value} active={personaDraft.challengeLevel === option.value} label={option.label} hint={option.hint} onClick={() => updatePersonaField("challengeLevel", option.value)} />
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[11px] text-muted-foreground">风险风格</p>
                      <div className="grid gap-2">
                        {RISK_STYLE_OPTIONS.map((option) => (
                          <OptionChip key={option.value} active={personaDraft.riskStyle === option.value} label={option.label} hint={option.hint} onClick={() => updatePersonaField("riskStyle", option.value)} />
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-2 md:max-w-sm">
                    <p className="text-[11px] text-muted-foreground">记忆风格</p>
                    {MEMORY_STYLE_OPTIONS.map((option) => (
                      <OptionChip key={option.value} active={personaDraft.memoryStyle === option.value} label={option.label} hint={option.hint} onClick={() => updatePersonaField("memoryStyle", option.value)} />
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">协作方式</p>
                    <Textarea className="min-h-[112px] rounded-xl border-border/80 bg-background/45" value={rulesDraft.collaborationStyle} onChange={(e) => updateRulesField("collaborationStyle", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">回答规则</p>
                    <Textarea className="min-h-[112px] rounded-xl border-border/80 bg-background/45" value={rulesDraft.responseRules} onChange={(e) => updateRulesField("responseRules", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">安全边界</p>
                    <Textarea className="min-h-[112px] rounded-xl border-border/80 bg-background/45" value={rulesDraft.safetyBoundaries} onChange={(e) => updateRulesField("safetyBoundaries", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">记忆策略</p>
                    <Textarea className="min-h-[112px] rounded-xl border-border/80 bg-background/45" value={rulesDraft.memoryPolicy} onChange={(e) => updateRulesField("memoryPolicy", e.target.value)} />
                  </div>
                </div>

                <Collapsible open={personaAdvancedOpen} onOpenChange={setPersonaAdvancedOpen}>
                  <div className="rounded-xl border border-border/70 bg-background/45">
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <div>
                        <p className="text-sm font-medium text-foreground">扩展策略</p>
                        <p className="text-xs text-muted-foreground">已启用 {personaPolicyCount} 条</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="outline" onClick={addPersonaCustomPolicy}>
                          <Plus className="mr-1.5 h-3.5 w-3.5" />
                          新增
                        </Button>
                        <CollapsibleTrigger asChild>
                          <Button size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground">
                            <ChevronDown className={cn("h-4 w-4 transition-transform", personaAdvancedOpen ? "rotate-180" : "")} />
                          </Button>
                        </CollapsibleTrigger>
                      </div>
                    </div>
                    <CollapsibleContent>
                      <div className="space-y-3 px-3 pb-3">
                        {personaDraft.customPolicies.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-border/80 bg-background/45 p-3 text-sm text-muted-foreground">暂无扩展策略。</div>
                        ) : (
                          personaDraft.customPolicies.map((item) => (
                            <div key={item.id} className="space-y-3 rounded-xl border border-border/70 bg-background/45 p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <Select
                                  value={item.category}
                                  onValueChange={(value) => updatePersonaCustomPolicy(item.id, { category: value as MindPolicyCategory })}
                                >
                                  <SelectTrigger className="h-9 w-[140px] rounded-lg border-border/80 bg-background/45">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {POLICY_CATEGORY_OPTIONS.map((option) => (
                                      <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Select
                                  value={String(item.priority)}
                                  onValueChange={(value) => updatePersonaCustomPolicy(item.id, { priority: Number(value) })}
                                >
                                  <SelectTrigger className="h-9 w-[112px] rounded-lg border-border/80 bg-background/45">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {[5, 4, 3, 2, 1].map((value) => (
                                      <SelectItem key={value} value={String(value)}>
                                        优先级 {value}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <label className="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground">
                                  启用
                                  <Switch
                                    checked={item.enabled}
                                    onCheckedChange={(checked) => updatePersonaCustomPolicy(item.id, { enabled: Boolean(checked) })}
                                    size="sm"
                                  />
                                </label>
                                <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                                  强约束
                                  <Switch
                                    checked={item.force}
                                    onCheckedChange={(checked) => updatePersonaCustomPolicy(item.id, { force: Boolean(checked) })}
                                    size="sm"
                                  />
                                </label>
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => removePersonaCustomPolicy(item.id)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                              <div className="grid gap-2 md:grid-cols-2">
                                <Input
                                  className="h-9 rounded-lg border-border/80 bg-background/45"
                                  value={item.trigger}
                                  onChange={(e) => updatePersonaCustomPolicy(item.id, { trigger: e.target.value })}
                                  placeholder="触发条件"
                                />
                                <Input
                                  className="h-9 rounded-lg border-border/80 bg-background/45"
                                  value={item.antiPattern}
                                  onChange={(e) => updatePersonaCustomPolicy(item.id, { antiPattern: e.target.value })}
                                  placeholder="避免动作（可选）"
                                />
                              </div>
                              <Textarea
                                className="min-h-[96px] rounded-lg border-border/80 bg-background/45"
                                value={item.expectedAction}
                                onChange={(e) => updatePersonaCustomPolicy(item.id, { expectedAction: e.target.value })}
                                placeholder="期望动作"
                              />
                            </div>
                          ))
                        )}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{lumosDirty ? "有未保存修改" : "已同步"}</p>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setLumosEditorOpen(false)}>
                    取消
                  </Button>
                  <Button size="sm" onClick={saveLumosProfile} disabled={savingLumos}>
                    {savingLumos ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                    保存
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <TabsContent value="together" className="space-y-6 animate-in fade-in-50 duration-200">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="border-border/70 bg-card shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-4 w-4 text-muted-foreground" />
                    关系成长
                  </CardTitle>
                  <CardDescription>当前关系阶段：{growth.stage}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <GrowthBar label="了解度" value={growth.understandingScore} />
                  <GrowthBar label="自洽度" value={growth.consistencyScore} />
                  <GrowthBar label="默契度" value={growth.tacitScore} />
                  <div className="grid gap-2 rounded-xl border border-border/70 bg-background/45 p-3 text-xs text-muted-foreground sm:grid-cols-3">
                    <div>
                      <p>记忆新增</p>
                      <p className="mt-1 text-sm font-medium text-foreground">{weekly.newMemories}</p>
                    </div>
                    <div>
                      <p>记忆更新</p>
                      <p className="mt-1 text-sm font-medium text-foreground">{weekly.updatedMemories}</p>
                    </div>
                    <div>
                      <p>命中次数</p>
                      <p className="mt-1 text-sm font-medium text-foreground">{weekly.reusedTimes}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/70 bg-card shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Brain className="h-4 w-4 text-muted-foreground" />
                    快捷动作
                  </CardTitle>
                  <CardDescription>常用操作。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button
                    className="w-full justify-center gap-2"
                    variant="outline"
                    onClick={applyBestPracticePreset}
                    disabled={presetApplying}
                  >
                    {presetApplying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    恢复推荐设定
                  </Button>
                  <Button className="w-full justify-center gap-2" onClick={() => void triggerMemory(false)} disabled={memoryRunning !== ""}>
                    {memoryRunning === "run" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
                    整理并写入记忆
                  </Button>
                  <Button
                    className="w-full justify-center gap-2"
                    variant="outline"
                    onClick={() => void triggerMemory(true)}
                    disabled={memoryRunning !== ""}
                  >
                    {memoryRunning === "dry" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                    先预览再决定
                  </Button>
                  <div className="mt-2 rounded-xl border border-border/70 bg-background/45 p-3 text-xs text-muted-foreground">
                    <p className="inline-flex items-center gap-1.5">
                      <Clock3 className="h-3.5 w-3.5" />
                      当前会话：
                      <span className="text-foreground">{snapshot.memoryIntelligence?.activeSession?.title || "未检测到"}</span>
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="border-border/70 bg-card shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Heart className="h-4 w-4 text-muted-foreground" />
                    最近记住的关键习惯
                  </CardTitle>
                  <CardDescription>仅展示会影响协作的记忆。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {recentMemories.length === 0 ? (
                    <p className="text-sm text-muted-foreground">暂时还没有稳定记忆。先聊几轮，我会逐步建立长期理解。</p>
                  ) : (
                    recentMemories.map((item) => (
                      <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-foreground">{item.content}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            最近更新：{toReadableDate(item.updatedAt)} · 命中 {item.hitCount} 次
                          </p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => void archiveMemory(item.id)}>
                          忘记这条
                        </Button>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/70 bg-card shadow-sm">
                <Collapsible open={runtimeDetailsOpen} onOpenChange={setRuntimeDetailsOpen}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">对话参考顺序</CardTitle>
                        <CardDescription>仅在相关时引用记忆与画像，当前轮指令始终优先。</CardDescription>
                      </div>
                      <CollapsibleTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground">
                          <ChevronDown className={cn("h-4 w-4 transition-transform", runtimeDetailsOpen ? "rotate-180" : "")} />
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                  </CardHeader>
                  <CollapsibleContent>
                    <CardContent className="space-y-2 pt-0">
                      {enabledRuntimeSections.length === 0 ? (
                        <p className="text-sm text-muted-foreground">暂无可用参考内容。</p>
                      ) : (
                        enabledRuntimeSections.map((section) => (
                          <div key={section.key} className="rounded-lg border border-border/70 bg-background/45 p-3">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <p className="text-sm font-medium text-foreground">
                                {section.key === "user"
                                  ? "你是谁"
                                  : section.key === "persona"
                                    ? "我是谁"
                                    : section.key === "rules"
                                      ? "相处约定"
                                      : "相关记忆"}
                              </p>
                              <Badge variant="outline" className="text-[11px]">
                                {section.lineCount} 行
                              </Badge>
                            </div>
                            <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{section.preview}</p>
                          </div>
                        ))
                      )}
                      {snapshot.runtimePack?.memoryItems ? (
                        <p className="pt-1 text-xs text-muted-foreground">本次上下文共注入 {snapshot.runtimePack.memoryItems} 条相关记忆。</p>
                      ) : null}
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            </div>

            <Card className="border-border/70 bg-card shadow-sm">
              <Collapsible open={changeLogOpen} onOpenChange={setChangeLogOpen}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">最近变更记录</CardTitle>
                      <CardDescription>快速回看“你是谁”和“我是谁”的更新轨迹。</CardDescription>
                    </div>
                    <CollapsibleTrigger asChild>
                      <Button size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground">
                        <ChevronDown className={cn("h-4 w-4 transition-transform", changeLogOpen ? "rotate-180" : "")} />
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent className="grid gap-2 pt-0 md:grid-cols-2">
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">你是谁</p>
                      {(snapshot.userHistory || []).slice(0, 4).map((item) => (
                        <div key={item.id} className="rounded-lg border border-border/70 px-3 py-2">
                          <p className="truncate text-sm text-foreground">{item.profile.longTermIdentity}</p>
                          <p className="text-xs text-muted-foreground">
                            {toReadableDate(item.saved_at)} · {item.source}
                          </p>
                        </div>
                      ))}
                      {(snapshot.userHistory || []).length === 0 ? <p className="text-xs text-muted-foreground">暂无记录。</p> : null}
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">我是谁</p>
                      {(snapshot.personaHistory || []).slice(0, 4).map((item) => (
                        <div key={item.id} className="rounded-lg border border-border/70 px-3 py-2">
                          <p className="truncate text-sm text-foreground">{item.profile.relationship}</p>
                          <p className="text-xs text-muted-foreground">
                            {toReadableDate(item.saved_at)} · {item.source}
                          </p>
                        </div>
                      ))}
                      {(snapshot.personaHistory || []).length === 0 ? <p className="text-xs text-muted-foreground">暂无记录。</p> : null}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
