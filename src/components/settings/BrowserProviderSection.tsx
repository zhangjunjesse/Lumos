"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatAdsPowerProfileNotes, getAdsPowerProfileGroup, getAdsPowerProfileSerialNumber } from "@/lib/browser-provider/adspower-metadata";
import { MainAgentBrowserSelect } from "./MainAgentBrowserSelect";
import { LocalChromeRow } from "./LocalChromeRow";
import { Check, Edit2, Loader2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import type {
  BrowserProfileSummary,
  BrowserProviderConfigResponse,
  BrowserProviderConfigView,
  BrowserProviderDraftTestRequest,
  BrowserProviderDraftTestResponse,
  BrowserProviderProfileImportRequest,
  BrowserProviderProfileImportResponse,
  BrowserProviderProfileSyncPlanItem,
  BrowserProviderProfileSyncResponse,
  BrowserProviderRuntimeReleaseResponse,
  BrowserProviderRuntimeStatus,
  BrowserProviderRuntimeStatusesResponse,
  BrowserProviderTestResponse,
  BrowserProviderType,
  BrowserProvidersResponse,
  CreateBrowserProviderConfigRequest,
  UpdateBrowserProviderConfigRequest,
} from "@/types";

type EditableBrowserProviderType = Exclude<BrowserProviderType, "embedded">;

interface BrowserProviderFormState {
  provider_type: EditableBrowserProviderType;
  display_name: string;
  enabled: boolean;
  api_base_url: string;
  api_key: string;
  clear_api_key: boolean;
  cdp_endpoint: string;
  profile_id: string;
  profile_name: string;
  aliases: string;
  notes: string;
}

const defaultForm: BrowserProviderFormState = {
  provider_type: "adspower",
  display_name: "",
  enabled: true,
  api_base_url: "http://127.0.0.1:50325",
  api_key: "",
  clear_api_key: false,
  cdp_endpoint: "",
  profile_id: "",
  profile_name: "",
  aliases: "",
  notes: "",
};

function createFormFromConfig(config: BrowserProviderConfigView | null): BrowserProviderFormState {
  if (!config) {
    return defaultForm;
  }
  return {
    provider_type: config.provider_type === "external-cdp" ? "external-cdp" : "adspower",
    display_name: config.display_name,
    enabled: config.enabled === 1,
    api_base_url: config.api_base_url || "http://127.0.0.1:50325",
    api_key: "",
    clear_api_key: false,
    cdp_endpoint: config.cdp_endpoint,
    profile_id: config.profile_id,
    profile_name: config.profile_name,
    aliases: (config.aliases || []).join("\n"),
    notes: config.notes,
  };
}

function getTypeLabel(type: BrowserProviderType): string {
  if (type === "embedded") return "内置浏览器";
  if (type === "adspower") return "AdsPower";
  return "通用 CDP";
}

function getStatusBadge(config: BrowserProviderConfigView) {
  if (config.last_test_status === "success") {
    return { label: "可连接", variant: "default" as const };
  }
  if (config.last_test_status === "failed") {
    return { label: "连接失败", variant: "destructive" as const };
  }
  return { label: "未测试", variant: "secondary" as const };
}

function parseAliasInput(raw: string): string[] {
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const item of raw.split(/[\n,，]/)) {
    const alias = item.trim();
    const key = alias.toLowerCase();
    if (!alias || seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
  }
  return aliases;
}

function mergeAliases(raw: string, candidates: Array<string | undefined>): string {
  const aliases = parseAliasInput(raw);
  const seen = new Set(aliases.map((alias) => alias.toLowerCase()));
  for (const candidate of candidates) {
    const alias = candidate?.trim();
    const key = alias?.toLowerCase();
    if (!alias || !key || seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
  }
  return aliases.join("\n");
}

function shouldReplaceDisplayName(config: Pick<BrowserProviderConfigView, "display_name" | "provider_type"> | null, current: string): boolean {
  const name = current.trim();
  if (!name) return true;
  const providerType = config?.provider_type || "adspower";
  return name === getTypeLabel(providerType) || name === "AdsPower" || name === "External CDP";
}

function getBrowserConfigGroup(config: BrowserProviderConfigView): string {
  if (config.provider_type === "adspower") {
    return getAdsPowerProfileGroup(config.notes);
  }
  return "通用 CDP";
}

function countSyncPlan(plan: BrowserProviderProfileSyncPlanItem[]) {
  return plan.reduce((acc, item) => {
    acc[item.action] += 1;
    return acc;
  }, { create: 0, update: 0, unchanged: 0, skip: 0 });
}

export function BrowserProviderSection() {
  const [configs, setConfigs] = useState<BrowserProviderConfigView[]>([]);
  const [localChromeContext, setLocalChromeContext] = useState<BrowserProvidersResponse["local_chrome_context"]>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [configQuery, setConfigQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState<"all" | EditableBrowserProviderType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled" | "occupied">("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BrowserProviderConfigView | null>(null);
  const [form, setForm] = useState<BrowserProviderFormState>(defaultForm);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [bindingProfileKey, setBindingProfileKey] = useState<string | null>(null);
  const [releasingContextId, setReleasingContextId] = useState<string | null>(null);
  const [importingProfiles, setImportingProfiles] = useState(false);
  const [syncingAdsPower, setSyncingAdsPower] = useState(false);
  const [applyingAdsPowerSync, setApplyingAdsPowerSync] = useState(false);
  const [syncPreviewOpen, setSyncPreviewOpen] = useState(false);
  const [syncPreview, setSyncPreview] = useState<BrowserProviderProfileSyncResponse | null>(null);
  const [testProfiles, setTestProfiles] = useState<Record<string, BrowserProviderTestResponse["profiles"]>>({});
  const [runtimeStatuses, setRuntimeStatuses] = useState<Record<string, BrowserProviderRuntimeStatus>>({});
  const [draftTesting, setDraftTesting] = useState(false);
  const [draftProfiles, setDraftProfiles] = useState<BrowserProfileSummary[]>([]);
  const [draftProfileQuery, setDraftProfileQuery] = useState("");
  const [draftProfileGroup, setDraftProfileGroup] = useState("all");
  const [draftTestMessage, setDraftTestMessage] = useState("");
  const [draftTestError, setDraftTestError] = useState("");

  const loadRuntimeStatuses = useCallback(async () => {
    try {
      const response = await fetch("/api/browser-providers/runtime-status");
      if (!response.ok) {
        setRuntimeStatuses({});
        return;
      }
      const payload = await response.json() as BrowserProviderRuntimeStatusesResponse;
      const next: Record<string, BrowserProviderRuntimeStatus> = {};
      for (const status of payload.statuses || []) {
        next[status.context_id] = status;
      }
      setRuntimeStatuses(next);
    } catch {
      setRuntimeStatuses({});
    }
  }, []);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/browser-providers");
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "加载浏览器接入失败");
      }
      const payload = await response.json() as BrowserProvidersResponse;
      setConfigs(payload.configs || []);
      setLocalChromeContext(payload.local_chrome_context ?? null);
      void loadRuntimeStatuses();
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载浏览器接入失败");
    } finally {
      setLoading(false);
    }
  }, [loadRuntimeStatuses]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (configs.length === 0) return;
    const timer = window.setInterval(() => {
      void loadRuntimeStatuses();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [configs.length, loadRuntimeStatuses]);

  const enabledCount = useMemo(() => configs.filter((config) => config.enabled === 1).length, [configs]);
  const adsPowerConfigs = useMemo(() => configs.filter((config) => config.provider_type === "adspower"), [configs]);
  const adsPowerGroups = useMemo(() => {
    const groups = new Set<string>();
    for (const config of adsPowerConfigs) {
      groups.add(getBrowserConfigGroup(config));
    }
    return Array.from(groups).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }, [adsPowerConfigs]);

  useEffect(() => {
    if (groupFilter !== "all" && !adsPowerGroups.includes(groupFilter)) {
      setGroupFilter("all");
    }
  }, [adsPowerGroups, groupFilter]);

  const filteredConfigs = useMemo(() => {
    const query = configQuery.trim().toLowerCase();
    return configs.filter((config) => {
      if (providerFilter !== "all" && config.provider_type !== providerFilter) return false;
      if (statusFilter === "enabled" && config.enabled !== 1) return false;
      if (statusFilter === "disabled" && config.enabled === 1) return false;
      if (statusFilter === "occupied" && !runtimeStatuses[config.context_id]?.occupied) return false;
      if (groupFilter !== "all" && (config.provider_type !== "adspower" || getBrowserConfigGroup(config) !== groupFilter)) return false;
      if (!query) return true;
      const group = getBrowserConfigGroup(config);
      const serialNumber = config.provider_type === "adspower" ? getAdsPowerProfileSerialNumber(config.notes) : "";
      const haystack = [
        config.display_name,
        config.context_id,
        config.profile_id,
        config.profile_name,
        config.cdp_endpoint,
        config.notes,
        group,
        serialNumber,
        ...config.aliases,
      ].join("\n").toLowerCase();
      return haystack.includes(query);
    });
  }, [configQuery, configs, groupFilter, providerFilter, runtimeStatuses, statusFilter]);

  const groupedConfigs = useMemo(() => {
    const sections: Array<{ key: string; title: string; count: number; configs: BrowserProviderConfigView[] }> = [];
    for (const config of filteredConfigs) {
      const group = getBrowserConfigGroup(config);
      const key = config.provider_type === "adspower" ? `adspower:${group}` : "external-cdp";
      let section = sections.find((item) => item.key === key);
      if (!section) {
        section = {
          key,
          title: config.provider_type === "adspower" ? `AdsPower · ${group}` : "通用 CDP",
          count: 0,
          configs: [],
        };
        sections.push(section);
      }
      section.configs.push(config);
      section.count += 1;
    }
    return sections;
  }, [filteredConfigs]);

  const resetDraftTestState = () => {
    setDraftProfiles([]);
    setDraftProfileQuery("");
    setDraftProfileGroup("all");
    setDraftTestMessage("");
    setDraftTestError("");
  };

  const openCreate = () => {
    setEditing(null);
    setForm(defaultForm);
    resetDraftTestState();
    setDialogOpen(true);
  };

  const openEdit = (config: BrowserProviderConfigView) => {
    setEditing(config);
    setForm(createFormFromConfig(config));
    resetDraftTestState();
    setDialogOpen(true);
  };

  const saveConfig = async () => {
    setSaving(true);
    setError("");
    setNotice("");
    const body: UpdateBrowserProviderConfigRequest = {
      display_name: form.display_name || getTypeLabel(form.provider_type),
      enabled: form.enabled,
      api_base_url: form.provider_type === "adspower" ? form.api_base_url : "",
      cdp_endpoint: form.provider_type === "external-cdp" ? form.cdp_endpoint : "",
      profile_id: form.provider_type === "adspower" ? form.profile_id : "",
      profile_name: form.provider_type === "adspower" ? form.profile_name : "",
      aliases: parseAliasInput(form.aliases),
      notes: form.notes,
      ...(form.api_key ? { api_key: form.api_key } : {}),
      ...(form.clear_api_key ? { clear_api_key: true } : {}),
    };
    const createBody: CreateBrowserProviderConfigRequest = {
      provider_type: form.provider_type,
      display_name: body.display_name || getTypeLabel(form.provider_type),
      enabled: body.enabled,
      api_base_url: body.api_base_url,
      api_key: form.api_key,
      cdp_endpoint: body.cdp_endpoint,
      profile_id: body.profile_id,
      profile_name: body.profile_name,
      aliases: body.aliases,
      notes: body.notes,
    };

    try {
      const response = await fetch(editing ? `/api/browser-providers/${editing.id}` : "/api/browser-providers", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? body : createBody),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "保存浏览器接入失败");
      }
      setDialogOpen(false);
      await load();
      setNotice("浏览器接入已保存");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存浏览器接入失败");
    } finally {
      setSaving(false);
    }
  };

  const testConfig = async (config: BrowserProviderConfigView) => {
    setTestingId(config.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/browser-providers/${config.id}/test`, { method: "POST" });
      const payload = await response.json().catch(() => ({})) as BrowserProviderTestResponse & { error?: string };
      if (!response.ok) {
        if (payload.config) {
          setConfigs((current) => current.map((item) => item.id === payload.config.id ? payload.config : item));
        }
        throw new Error(payload.message || payload.error || "测试连接失败");
      }
      setConfigs((current) => current.map((item) => item.id === payload.config.id ? payload.config : item));
      setTestProfiles((current) => ({ ...current, [config.id]: payload.profiles || [] }));
      await loadRuntimeStatuses();
    } catch (err) {
      setError(err instanceof Error ? err.message : "测试连接失败");
    } finally {
      setTestingId(null);
    }
  };

  const discoverDraftProfiles = async () => {
    if (form.provider_type !== "adspower") return;
    setDraftTesting(true);
    setDraftTestMessage("");
    setDraftTestError("");
    setError("");
    setNotice("");

    const body: BrowserProviderDraftTestRequest = {
      config_id: editing?.id,
      provider_type: form.provider_type,
      display_name: form.display_name,
      api_base_url: form.api_base_url,
      api_key: form.api_key,
      cdp_endpoint: form.cdp_endpoint,
      profile_id: "",
      profile_name: form.profile_name,
    };

    try {
      const response = await fetch("/api/browser-providers/test-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({})) as BrowserProviderDraftTestResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.message || payload.error || "发现 AdsPower Profile 失败");
      }
      setDraftProfiles(payload.profiles || []);
      setDraftTestMessage(payload.message || `发现 ${payload.profile_count || 0} 个 Profile`);
    } catch (err) {
      setDraftProfiles([]);
      setDraftTestError(err instanceof Error ? err.message : "发现 AdsPower Profile 失败");
    } finally {
      setDraftTesting(false);
    }
  };

  const applyProfileToForm = (profile: BrowserProfileSummary) => {
    setForm((current) => ({
      ...current,
      display_name: shouldReplaceDisplayName(editing, current.display_name)
        ? (profile.name || current.display_name || "AdsPower")
        : current.display_name,
      profile_id: profile.id,
      profile_name: profile.name || current.profile_name,
      aliases: mergeAliases(current.aliases, [profile.name]),
      notes: formatAdsPowerProfileNotes(profile, current.notes),
    }));
    setDraftTestMessage(`已绑定 ${profile.name || profile.id}，保存后生效`);
    setDraftTestError("");
  };

  const importDraftProfiles = async () => {
    if (form.provider_type !== "adspower" || draftProfiles.length === 0) return;
    setImportingProfiles(true);
    setError("");
    setNotice("");
    const body: BrowserProviderProfileImportRequest = {
      source_config_id: editing?.id,
      provider_type: "adspower",
      api_base_url: form.api_base_url,
      api_key: form.api_key,
      profiles: draftProfiles,
      enabled: true,
    };

    try {
      const response = await fetch("/api/browser-providers/import-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({})) as BrowserProviderProfileImportResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "批量导入 Profile 失败");
      }
      setNotice(`已导入 ${payload.created.length} 个 Profile${payload.skipped.length ? `，跳过 ${payload.skipped.length} 个` : ""}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量导入 Profile 失败");
    } finally {
      setImportingProfiles(false);
    }
  };

  const syncAdsPowerProfiles = async () => {
    setSyncingAdsPower(true);
    setError("");
    setNotice("");
    setSyncPreview(null);
    const sourceConfig = adsPowerConfigs.find((config) => config.enabled === 1) || adsPowerConfigs[0];
    try {
      const response = await fetch("/api/browser-providers/sync-adspower", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_config_id: sourceConfig?.id,
          enabled: true,
          max_profiles: 500,
          dry_run: true,
        }),
      });
      const payload = await response.json().catch(() => ({})) as BrowserProviderProfileSyncResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "同步 AdsPower Profile 失败");
      }
      setSyncPreview(payload);
      setSyncPreviewOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "同步 AdsPower Profile 失败");
    } finally {
      setSyncingAdsPower(false);
    }
  };

  const applyAdsPowerSync = async () => {
    setApplyingAdsPowerSync(true);
    setError("");
    setNotice("");
    const sourceConfig = adsPowerConfigs.find((config) => config.enabled === 1) || adsPowerConfigs[0];
    try {
      const response = await fetch("/api/browser-providers/sync-adspower", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_config_id: sourceConfig?.id,
          enabled: true,
          max_profiles: 500,
        }),
      });
      const payload = await response.json().catch(() => ({})) as BrowserProviderProfileSyncResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "同步 AdsPower Profile 失败");
      }
      setNotice(`已同步 ${payload.profile_count || 0} 个 AdsPower Profile：新增 ${payload.created.length} 个，更新 ${payload.updated.length} 个${payload.unchanged ? `，不变 ${payload.unchanged} 个` : ""}${payload.skipped.length ? `，跳过 ${payload.skipped.length} 个` : ""}`);
      setSyncPreviewOpen(false);
      setSyncPreview(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "同步 AdsPower Profile 失败");
    } finally {
      setApplyingAdsPowerSync(false);
    }
  };

  const bindProfileToConfig = async (config: BrowserProviderConfigView, profile: BrowserProfileSummary) => {
    const bindingKey = `${config.id}:${profile.id}`;
    setBindingProfileKey(bindingKey);
    setError("");
    setNotice("");
    try {
      const aliases = mergeAliases((config.aliases || []).join("\n"), [profile.name]);
      const body: UpdateBrowserProviderConfigRequest = {
        enabled: true,
        profile_id: profile.id,
        profile_name: profile.name || config.profile_name,
        aliases: parseAliasInput(aliases),
        notes: formatAdsPowerProfileNotes(profile, config.notes),
        display_name: shouldReplaceDisplayName(config, config.display_name)
          ? (profile.name || config.display_name)
          : config.display_name,
      };
      const response = await fetch(`/api/browser-providers/${config.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({})) as BrowserProviderConfigResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "绑定 Profile 失败");
      }
      setConfigs((current) => current.map((item) => item.id === payload.config.id ? payload.config : item));
      setTestProfiles((current) => ({
        ...current,
        [config.id]: (current[config.id] || []).map((item) => item.id === profile.id
          ? { ...item, name: item.name || profile.name }
          : item),
      }));
      setNotice(`已绑定 ${profile.name || profile.id}`);
      await loadRuntimeStatuses();
    } catch (err) {
      setError(err instanceof Error ? err.message : "绑定 Profile 失败");
    } finally {
      setBindingProfileKey(null);
    }
  };

  const deleteConfig = async (config: BrowserProviderConfigView) => {
    setDeletingId(config.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/browser-providers/${config.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "删除浏览器接入失败");
      }
      await load();
      setNotice("浏览器接入已删除");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除浏览器接入失败");
    } finally {
      setDeletingId(null);
    }
  };

  const releaseRuntimeContext = async (config: BrowserProviderConfigView) => {
    setReleasingContextId(config.context_id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/browser-providers/runtime-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context_id: config.context_id }),
      });
      const payload = await response.json().catch(() => ({})) as BrowserProviderRuntimeReleaseResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "释放浏览器占用失败");
      }
      setNotice(payload.released ? "已释放浏览器占用" : "当前没有运行态占用");
      await loadRuntimeStatuses();
    } catch (err) {
      setError(err instanceof Error ? err.message : "释放浏览器占用失败");
    } finally {
      setReleasingContextId(null);
    }
  };

  const handleDialogFormChange = (nextForm: BrowserProviderFormState) => {
    if (
      nextForm.provider_type !== form.provider_type
      || nextForm.api_base_url !== form.api_base_url
      || nextForm.api_key !== form.api_key
    ) {
      resetDraftTestState();
    }
    setForm(nextForm);
  };

  return (
    <>
      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base font-semibold">浏览器接入</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                管理 Lumos 可接管的本地浏览器上下文。内置浏览器始终可用，第三方浏览器需要本机开放 CDP 或 Local API。
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={openCreate}>
              <Plus data-icon="inline-start" />
              添加接入
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="mt-1.5 size-2 rounded-full bg-primary" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">内置浏览器</p>
                    <Badge variant="default" className="text-[10px]">默认</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Context: embedded:default</p>
                </div>
              </div>
            </div>

            <LocalChromeRow />

            <MainAgentBrowserSelect configs={configs} localChrome={localChromeContext} />

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}
            {notice && (
              <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
                <p className="text-xs text-primary">{notice}</p>
              </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">第三方浏览器</p>
                <p className="text-xs text-muted-foreground">已启用 {enabledCount} 个接入，当前显示 {filteredConfigs.length} 个</p>
              </div>
              <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                <Button variant="outline" size="sm" onClick={() => void syncAdsPowerProfiles()} disabled={syncingAdsPower}>
                  {syncingAdsPower ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <RefreshCw data-icon="inline-start" />}
                  同步 AdsPower
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
                  {loading ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <RefreshCw data-icon="inline-start" />}
                  刷新
                </Button>
              </div>
            </div>

            <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_160px_160px_180px]">
              <Input
                value={configQuery}
                onChange={(event) => setConfigQuery(event.target.value)}
                placeholder="搜索名称、别名、Profile ID、Context"
              />
              <Select value={providerFilter} onValueChange={(value) => setProviderFilter(value as typeof providerFilter)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">全部类型</SelectItem>
                    <SelectItem value="adspower">AdsPower</SelectItem>
                    <SelectItem value="external-cdp">通用 CDP</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">全部状态</SelectItem>
                    <SelectItem value="enabled">已启用</SelectItem>
                    <SelectItem value="disabled">已停用</SelectItem>
                    <SelectItem value="occupied">AI 操作中</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Select value={groupFilter} onValueChange={setGroupFilter} disabled={adsPowerGroups.length === 0}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">全部分组</SelectItem>
                    {adsPowerGroups.map((group) => (
                      <SelectItem key={group} value={group}>{group}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="animate-spin text-muted-foreground" />
              </div>
            ) : configs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center">
                <p className="text-sm text-muted-foreground">还没有添加第三方浏览器接入</p>
              </div>
            ) : filteredConfigs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center">
                <p className="text-sm text-muted-foreground">没有匹配的浏览器接入</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {groupedConfigs.map((section) => (
                  <div key={section.key} className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 px-1">
                      <p className="text-xs font-medium text-muted-foreground">{section.title}</p>
                      <Badge variant="outline" className="text-[10px]">{section.count} 个</Badge>
                    </div>
                    {section.configs.map((config) => {
                      const status = getStatusBadge(config);
                      const profiles = testProfiles[config.id] || [];
                      const runtimeStatus = runtimeStatuses[config.context_id];
                      const group = getBrowserConfigGroup(config);
                      const serialNumber = config.provider_type === "adspower" ? getAdsPowerProfileSerialNumber(config.notes) : "";
                      return (
                        <div key={config.id} className="rounded-lg border border-border/50 px-4 py-3">
                          <div className="flex items-start gap-3">
                            <div className={config.enabled ? "mt-1.5 size-2 rounded-full bg-primary" : "mt-1.5 size-2 rounded-full bg-muted-foreground/40"} />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate text-sm font-medium">{config.display_name}</p>
                                <Badge variant="secondary" className="text-[10px]">{getTypeLabel(config.provider_type)}</Badge>
                                {config.provider_type === "adspower" && <Badge variant="outline" className="text-[10px]">{group}</Badge>}
                                {serialNumber && <Badge variant="outline" className="text-[10px]">序号 {serialNumber}</Badge>}
                                <Badge variant={status.variant} className="text-[10px]">{status.label}</Badge>
                                {!config.enabled && <Badge variant="outline" className="text-[10px]">已停用</Badge>}
                                {runtimeStatus?.occupied && <Badge variant="default" className="text-[10px]">AI 操作中</Badge>}
                                {runtimeStatus?.error && <Badge variant="outline" className="text-[10px]">运行态未知</Badge>}
                              </div>
                              <p className="mt-1 truncate text-xs text-muted-foreground">Context: {config.context_id}</p>
                              <p className="mt-1 truncate text-xs text-muted-foreground">
                                {config.provider_type === "adspower"
                                  ? `Profile: ${config.profile_id || "未填写"}`
                                  : config.cdp_endpoint || "未填写 CDP 地址"}
                              </p>
                              {config.last_test_message && (
                                <p className="mt-2 text-xs text-muted-foreground">{config.last_test_message}</p>
                              )}
                              {profiles.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {profiles.slice(0, 5).map((profile) => (
                                    <span key={profile.id} className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[10px]">
                                      <span className="max-w-40 truncate">{profile.name || profile.id}</span>
                                      {config.provider_type === "adspower" && profile.id === config.profile_id ? (
                                        <Badge variant="secondary" className="h-4 px-1 text-[9px]">当前</Badge>
                                      ) : config.provider_type === "adspower" ? (
                                        <button
                                          type="button"
                                          className="text-primary hover:underline disabled:opacity-60"
                                          disabled={bindingProfileKey === `${config.id}:${profile.id}`}
                                          onClick={() => void bindProfileToConfig(config, profile)}
                                        >
                                          {bindingProfileKey === `${config.id}:${profile.id}` ? "绑定中" : "绑定"}
                                        </button>
                                      ) : null}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {config.aliases.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {config.aliases.slice(0, 6).map((alias) => (
                                    <Badge key={alias} variant="outline" className="text-[10px]">
                                      {alias}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                              {(config.usage.chat_session_count > 0 || config.usage.schedule_count > 0) && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  <Badge variant="secondary" className="text-[10px]">引用中</Badge>
                                  {config.usage.chat_session_count > 0 && (
                                    <Badge variant="outline" className="text-[10px]">
                                      聊天 {config.usage.chat_session_count}
                                    </Badge>
                                  )}
                                  {config.usage.schedule_count > 0 && (
                                    <Badge variant="outline" className="text-[10px]">
                                      工作流 {config.usage.schedule_count}
                                    </Badge>
                                  )}
                                  {config.usage.enabled_schedule_count > 0 && (
                                    <Badge variant="outline" className="text-[10px]">
                                      启用中 {config.usage.enabled_schedule_count}
                                    </Badge>
                                  )}
                                </div>
                              )}
                              {runtimeStatus?.occupied && (
                                <p className="mt-2 truncate text-xs text-muted-foreground">
                                  占用来源: {runtimeStatus.owner_id || "未知"}{runtimeStatus.expires_at ? ` · 自动过期 ${new Date(runtimeStatus.expires_at).toLocaleTimeString()}` : ""}
                                </p>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              {runtimeStatus?.occupied && (
                                <Button variant="outline" size="sm" onClick={() => void releaseRuntimeContext(config)} disabled={releasingContextId === config.context_id}>
                                  {releasingContextId === config.context_id ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
                                  释放占用
                                </Button>
                              )}
                              <Button variant="outline" size="sm" onClick={() => void testConfig(config)} disabled={testingId === config.id}>
                                {testingId === config.id ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Check data-icon="inline-start" />}
                                测试
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => openEdit(config)}>
                                <Edit2 data-icon="inline-start" />
                                编辑
                              </Button>
                              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => void deleteConfig(config)} disabled={deletingId === config.id}>
                                {deletingId === config.id ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Trash2 data-icon="inline-start" />}
                                删除
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <BrowserProviderDialog
        open={dialogOpen}
        editing={editing}
        form={form}
        saving={saving}
        draftTesting={draftTesting}
        draftProfiles={draftProfiles}
        draftProfileQuery={draftProfileQuery}
        draftProfileGroup={draftProfileGroup}
        draftTestMessage={draftTestMessage}
        draftTestError={draftTestError}
        importingProfiles={importingProfiles}
        onOpenChange={setDialogOpen}
        onFormChange={handleDialogFormChange}
        onDraftProfileQueryChange={setDraftProfileQuery}
        onDraftProfileGroupChange={setDraftProfileGroup}
        onDiscoverProfiles={() => void discoverDraftProfiles()}
        onApplyProfile={applyProfileToForm}
        onImportProfiles={() => void importDraftProfiles()}
        onSave={() => void saveConfig()}
      />

      <AdsPowerSyncPreviewDialog
        open={syncPreviewOpen}
        preview={syncPreview}
        applying={applyingAdsPowerSync}
        onOpenChange={setSyncPreviewOpen}
        onApply={() => void applyAdsPowerSync()}
      />
    </>
  );
}

interface BrowserProviderDialogProps {
  open: boolean;
  editing: BrowserProviderConfigView | null;
  form: BrowserProviderFormState;
  saving: boolean;
  draftTesting: boolean;
  draftProfiles: BrowserProfileSummary[];
  draftProfileQuery: string;
  draftProfileGroup: string;
  draftTestMessage: string;
  draftTestError: string;
  importingProfiles: boolean;
  onOpenChange: (open: boolean) => void;
  onFormChange: (form: BrowserProviderFormState) => void;
  onDraftProfileQueryChange: (query: string) => void;
  onDraftProfileGroupChange: (group: string) => void;
  onDiscoverProfiles: () => void;
  onApplyProfile: (profile: BrowserProfileSummary) => void;
  onImportProfiles: () => void;
  onSave: () => void;
}

function AdsPowerSyncPreviewDialog({
  open,
  preview,
  applying,
  onOpenChange,
  onApply,
}: {
  open: boolean;
  preview: BrowserProviderProfileSyncResponse | null;
  applying: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: () => void;
}) {
  const plan = preview?.plan || [];
  const counts = countSyncPlan(plan);
  const actionableCount = counts.create + counts.update;
  const visiblePlan = plan.slice(0, 80);

  const actionLabel: Record<BrowserProviderProfileSyncPlanItem["action"], string> = {
    create: "新增",
    update: "更新",
    unchanged: "不变",
    skip: "跳过",
  };
  const actionVariant: Record<BrowserProviderProfileSyncPlanItem["action"], "default" | "secondary" | "outline" | "destructive"> = {
    create: "default",
    update: "secondary",
    unchanged: "outline",
    skip: "destructive",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>同步 AdsPower Profile</DialogTitle>
          <DialogDescription>
            先确认本次同步计划。确认后才会新增或更新 Lumos 浏览器配置。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <div className="rounded-md bg-muted/40 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">发现</p>
              <p className="text-sm font-medium">{preview?.profile_count || 0}</p>
            </div>
            <div className="rounded-md bg-muted/40 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">新增</p>
              <p className="text-sm font-medium">{counts.create}</p>
            </div>
            <div className="rounded-md bg-muted/40 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">更新</p>
              <p className="text-sm font-medium">{counts.update}</p>
            </div>
            <div className="rounded-md bg-muted/40 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">不变</p>
              <p className="text-sm font-medium">{counts.unchanged}</p>
            </div>
            <div className="rounded-md bg-muted/40 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">跳过</p>
              <p className="text-sm font-medium">{counts.skip}</p>
            </div>
          </div>

          <div className="max-h-[420px] overflow-y-auto rounded-md border border-border/70">
            {visiblePlan.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">没有可同步的 Profile</p>
            ) : (
              <div className="divide-y divide-border/70">
                {visiblePlan.map((item) => (
                  <div key={`${item.action}:${item.profile_id}`} className="grid gap-2 px-3 py-2 md:grid-cols-[96px_minmax(0,1fr)]">
                    <div className="flex items-start">
                      <Badge variant={actionVariant[item.action]} className="text-[10px]">
                        {actionLabel[item.action]}
                      </Badge>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">{item.display_name || item.name || item.profile_id}</p>
                        {item.group ? <Badge variant="outline" className="text-[10px]">{item.group}</Badge> : null}
                        {item.serial_number ? <Badge variant="outline" className="text-[10px]">序号 {item.serial_number}</Badge> : null}
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.context_id}</p>
                      {item.changes.length > 0 ? (
                        <p className="mt-1 text-xs text-muted-foreground">{item.changes.join("；")}</p>
                      ) : item.reason ? (
                        <p className="mt-1 text-xs text-muted-foreground">{item.reason}</p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {plan.length > visiblePlan.length ? (
            <p className="text-xs text-muted-foreground">仅显示前 {visiblePlan.length} 条，确认后会按完整计划同步 {plan.length} 条。</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>取消</Button>
          <Button onClick={onApply} disabled={applying || actionableCount === 0}>
            {applying ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
            应用同步
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BrowserProviderDialog({
  open,
  editing,
  form,
  saving,
  draftTesting,
  draftProfiles,
  draftProfileQuery,
  draftProfileGroup,
  draftTestMessage,
  draftTestError,
  importingProfiles,
  onOpenChange,
  onFormChange,
  onDraftProfileQueryChange,
  onDraftProfileGroupChange,
  onDiscoverProfiles,
  onApplyProfile,
  onImportProfiles,
  onSave,
}: BrowserProviderDialogProps) {
  const setField = <K extends keyof BrowserProviderFormState>(key: K, value: BrowserProviderFormState[K]) => {
    onFormChange({ ...form, [key]: value });
  };
  const filteredDraftProfiles = useMemo(() => {
    const query = draftProfileQuery.trim().toLowerCase();
    const group = draftProfileGroup.trim();
    return draftProfiles.filter((profile) =>
      (group === "all" || (profile.group || profile.status || "未分组") === group)
      && (!query || [profile.name, profile.id, profile.status, profile.group, profile.serial_number].join("\n").toLowerCase().includes(query)),
    );
  }, [draftProfileGroup, draftProfileQuery, draftProfiles]);
  const draftProfileGroups = useMemo(() => {
    const groups = new Set<string>();
    for (const profile of draftProfiles) {
      groups.add(profile.group || profile.status || "未分组");
    }
    return Array.from(groups).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }, [draftProfiles]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑浏览器接入" : "添加浏览器接入"}</DialogTitle>
          <DialogDescription>
            保存后 Lumos 会把接入写入本地运行时配置，浏览器工具可通过对应 context 使用。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="browser-provider-type">类型</Label>
              <Select
                value={form.provider_type}
                onValueChange={(value) => setField("provider_type", value as EditableBrowserProviderType)}
                disabled={Boolean(editing)}
              >
                <SelectTrigger id="browser-provider-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="adspower">AdsPower</SelectItem>
                    <SelectItem value="external-cdp">通用 CDP</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="browser-provider-name">名称</Label>
              <Input
                id="browser-provider-name"
                value={form.display_name}
                onChange={(event) => setField("display_name", event.target.value)}
                placeholder={form.provider_type === "adspower" ? "AdsPower / 美区店铺-001" : "外部 Chrome 调试端口"}
              />
            </div>
          </div>

          {form.provider_type === "adspower" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="adspower-api-base">Local API 地址</Label>
                <div className="flex gap-2">
                  <Input
                    id="adspower-api-base"
                    value={form.api_base_url}
                    onChange={(event) => setField("api_base_url", event.target.value)}
                    placeholder="http://127.0.0.1:50325"
                  />
                  <Button type="button" variant="outline" onClick={onDiscoverProfiles} disabled={draftTesting}>
                    {draftTesting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Search data-icon="inline-start" />}
                    发现 Profile
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="adspower-profile-id">Profile ID / user_id</Label>
                <Input
                  id="adspower-profile-id"
                  value={form.profile_id}
                  onChange={(event) => setField("profile_id", event.target.value)}
                  placeholder="AdsPower user_id"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="adspower-profile-name">Profile 显示名</Label>
                <Input
                  id="adspower-profile-name"
                  value={form.profile_name}
                  onChange={(event) => setField("profile_name", event.target.value)}
                  placeholder="美区店铺-001"
                />
              </div>
              {(draftTestMessage || draftTestError || draftProfiles.length > 0) && (
                <div className="flex flex-col gap-2 rounded-md border border-border/70 px-3 py-2 md:col-span-2">
                  {draftTestError ? (
                    <p className="text-xs text-destructive">{draftTestError}</p>
                  ) : draftTestMessage ? (
                    <p className="text-xs text-muted-foreground">{draftTestMessage}</p>
                  ) : null}
                  {draftProfiles.length > 0 && (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground">已发现 {draftProfiles.length} 个 Profile，当前显示 {filteredDraftProfiles.length} 个</p>
                        <Button type="button" size="sm" variant="outline" onClick={onImportProfiles} disabled={importingProfiles}>
                          {importingProfiles ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
                          批量导入
                        </Button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
                        <Input
                          value={draftProfileQuery}
                          onChange={(event) => onDraftProfileQueryChange(event.target.value)}
                          placeholder="搜索 Profile 名称、ID、分组"
                        />
                        <Select value={draftProfileGroup} onValueChange={onDraftProfileGroupChange}>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="all">全部分组</SelectItem>
                              {draftProfileGroups.map((group) => (
                                <SelectItem key={group} value={group}>{group}</SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {filteredDraftProfiles.map((profile) => {
                          const selected = profile.id === form.profile_id;
                          const group = profile.group || profile.status || "";
                          return (
                            <div key={profile.id} className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-2">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-medium">{profile.name || profile.id}</p>
                                <p className="truncate text-[11px] text-muted-foreground">{profile.id}{group ? ` · ${group}` : ""}</p>
                              </div>
                              <Button type="button" size="sm" variant={selected ? "secondary" : "outline"} onClick={() => onApplyProfile(profile)}>
                                {selected ? "已选" : "绑定"}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                      {filteredDraftProfiles.length === 0 && (
                        <p className="rounded-md bg-muted/40 px-2 py-3 text-center text-xs text-muted-foreground">没有匹配的 Profile</p>
                      )}
                    </>
                  )}
                </div>
              )}
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="browser-profile-aliases">别名</Label>
                <Textarea
                  id="browser-profile-aliases"
                  value={form.aliases}
                  onChange={(event) => setField("aliases", event.target.value)}
                  placeholder={"浏览器1\n店铺A\n美区账号"}
                  rows={3}
                />
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="adspower-api-key">API Key</Label>
                <Input
                  id="adspower-api-key"
                  type="password"
                  value={form.api_key}
                  onChange={(event) => setField("api_key", event.target.value)}
                  placeholder={editing?.has_api_key ? "留空表示不修改已保存密钥" : "可选"}
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="external-cdp-endpoint">DevTools 地址</Label>
              <Input
                id="external-cdp-endpoint"
                value={form.cdp_endpoint}
                onChange={(event) => setField("cdp_endpoint", event.target.value)}
                placeholder="http://127.0.0.1:9222 或 ws://127.0.0.1:9222/devtools/browser/..."
              />
            </div>
          )}

          {editing?.has_api_key && (
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.clear_api_key}
                onCheckedChange={(checked) => setField("clear_api_key", checked)}
              />
              清除已保存的 API Key
            </label>
          )}

          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.enabled} onCheckedChange={(checked) => setField("enabled", checked)} />
            启用这个浏览器上下文
          </label>

          <div className="flex flex-col gap-2">
            <Label htmlFor="browser-provider-notes">备注</Label>
            <Textarea
              id="browser-provider-notes"
              value={form.notes}
              onChange={(event) => setField("notes", event.target.value)}
              placeholder="店铺、账号或使用边界备注"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
