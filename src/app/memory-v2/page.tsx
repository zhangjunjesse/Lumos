"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Brain,
  Check,
  ChevronDown,
  Clock3,
  Database,
  ExternalLink,
  Hammer,
  KeyRound,
  Loader2,
  Moon,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  Users,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { stashPendingChatBootstrap } from "@/lib/chat/session-bootstrap";
import { cn } from "@/lib/utils";

type MemoryKind = "task" | "people" | "resource" | "capability" | "reflection";
type ScopeType = "user" | "main_agent" | "project" | "session" | "module" | "entity";
type MemoryStatus = "candidate" | "active" | "archived" | "rejected";
type Sensitivity = "normal" | "sensitive_ref" | "secret_ref_required";
type ImprovementType = "skill" | "mcp" | "workflow" | "prompt" | "rule";
type ImprovementStatus = "candidate" | "approved" | "building" | "built" | "rejected" | "failed";
type ImprovementRisk = "low" | "medium" | "high";
type CapabilityLabType = "skill" | "mcp";
type CapabilityLabVerdict = "safe" | "review_required" | "blocked" | "unknown";

interface MemoryV2Item {
  id: string;
  kind: MemoryKind;
  scopeType: ScopeType;
  scopeKey: string;
  ownerModule: string;
  status: MemoryStatus;
  title: string;
  body: string;
  summary: string;
  tags: string[];
  sensitivity: Sensitivity;
  secretRef: string;
  importance: number;
  confidence: number;
  evidence: string;
  projectPath: string;
  updatedAt: string;
  createdAt: string;
  lastUsedAt: string | null;
  hitCount: number;
}

interface ReflectionIssue {
  id: string;
  severity: "info" | "warning" | "critical";
  category: string;
  title: string;
  detail: string;
  memoryIds: string[];
}

interface ReflectionReport {
  generatedAt: string;
  stats: {
    total: number;
    active: number;
    candidates: number;
    resourcesNeedingVault: number;
    byKind: Record<MemoryKind, number>;
  };
  issues: ReflectionIssue[];
}

interface SleepConfig {
  enabled: boolean;
  time: string;
  timezone: string;
  today: string;
  due: boolean;
  lastRunDay: string;
  lastRunAt: string | null;
  nextRunLabel: string;
}

interface SleepRun {
  id: string;
  triggerType: string;
  runDay: string;
  status: "success" | "skipped" | "error";
  memoryId: string;
  error: string;
  completedAt: string;
}

interface SleepState {
  config: SleepConfig;
  runs: SleepRun[];
}

type SleepDraft = Pick<SleepConfig, "enabled" | "time" | "timezone">;

interface ImprovementCandidate {
  id: string;
  candidateType: ImprovementType;
  status: ImprovementStatus;
  title: string;
  problem: string;
  evidence: string;
  proposedCapability: string;
  sourceMemoryIds: string[];
  riskLevel: ImprovementRisk;
  builderSessionId: string;
  updatedAt: string;
  createdAt: string;
}

interface CapabilityLabScan {
  verdict: CapabilityLabVerdict;
  riskLevel: ImprovementRisk;
  filesScanned: number;
  findings: Array<{
    id: string;
    severity: string;
    category: string;
    message: string;
    filePath: string;
    evidence: string;
  }>;
  policy?: {
    installAllowed: boolean;
    rewriteRequired: boolean;
    userApprovalRequired: boolean;
    missingAcceptance: string[];
    requiredReview: string[];
    blockedReasons: string[];
  };
  patterns: string[];
  rewriteTarget: string;
}

const KIND_LABELS: Record<MemoryKind, string> = {
  task: "任务账",
  people: "人/角色账",
  resource: "资源账",
  capability: "能力账",
  reflection: "复盘账",
};

const KIND_HINTS: Record<MemoryKind, string> = {
  task: "背景、目标、状态、决策、下一步",
  people: "用户、参与方、沟通偏好、责任边界",
  resource: "账号、登录态、服务器、文件、权限、关键参数",
  capability: "工具、MCP、Skill、Agent、能力缺口",
  reflection: "经验、教训、失败原因、下次改进",
};

const SCOPE_LABELS: Record<ScopeType, string> = {
  user: "用户全局",
  main_agent: "主代理",
  project: "项目",
  session: "会话",
  module: "模块",
  entity: "对象",
};

const STATUS_LABELS: Record<MemoryStatus, string> = {
  candidate: "候选",
  active: "生效",
  archived: "已停用",
  rejected: "已忽略",
};

const IMPROVEMENT_STATUS_LABELS: Record<ImprovementStatus, string> = {
  candidate: "候选",
  approved: "已批准",
  building: "生成中",
  built: "已完成",
  rejected: "已忽略",
  failed: "失败",
};

const IMPROVEMENT_TYPE_LABELS: Record<ImprovementType, string> = {
  skill: "Skill",
  mcp: "MCP",
  workflow: "工作流",
  prompt: "提示词",
  rule: "规则",
};

const KIND_ICONS: Record<MemoryKind, typeof Database> = {
  task: Database,
  people: Users,
  resource: KeyRound,
  capability: Wrench,
  reflection: Brain,
};

const DEFAULT_DRAFT = {
  kind: "task" as MemoryKind,
  scopeType: "user" as ScopeType,
  scopeKey: "default",
  title: "",
  body: "",
  tags: "",
  importance: 3,
  sensitivity: "normal" as Sensitivity,
  secretRef: "",
};

const DEFAULT_LAB_DRAFT = {
  capabilityType: "skill" as CapabilityLabType,
  capabilityName: "",
  sourceUrl: "",
  content: "",
  download: false,
};

const DEFAULT_SLEEP_CONFIG: SleepConfig = {
  enabled: true,
  time: "03:30",
  timezone: "Asia/Shanghai",
  today: "",
  due: false,
  lastRunDay: "",
  lastRunAt: null,
  nextRunLabel: "今天 03:30",
};

function formatTime(value?: string | null): string {
  if (!value) return "从未";
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function statusClass(status: MemoryStatus): string {
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "candidate") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "rejected") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-zinc-200 bg-zinc-50 text-zinc-600";
}

function severityClass(severity: ReflectionIssue["severity"]): string {
  if (severity === "critical") return "border-rose-200 bg-rose-50 text-rose-800";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-sky-200 bg-sky-50 text-sky-800";
}

function improvementStatusClass(status: ImprovementStatus): string {
  if (status === "built") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "building" || status === "approved") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "rejected" || status === "failed") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function riskClass(risk: ImprovementRisk): string {
  if (risk === "high") return "border-rose-200 bg-rose-50 text-rose-700";
  if (risk === "medium") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-zinc-200 bg-zinc-50 text-zinc-600";
}

function labVerdictClass(verdict: CapabilityLabVerdict): string {
  if (verdict === "safe") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (verdict === "blocked") return "border-rose-200 bg-rose-50 text-rose-700";
  if (verdict === "review_required") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-zinc-200 bg-zinc-50 text-zinc-600";
}

function labVerdictLabel(verdict: CapabilityLabVerdict): string {
  if (verdict === "safe") return "可作为参考";
  if (verdict === "blocked") return "禁止直装";
  if (verdict === "review_required") return "需要审核";
  return "未扫描";
}

export default function MemoryV2Page() {
  const router = useRouter();
  const [memories, setMemories] = useState<MemoryV2Item[]>([]);
  const [improvements, setImprovements] = useState<ImprovementCandidate[]>([]);
  const [report, setReport] = useState<ReflectionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reflecting, setReflecting] = useState(false);
  const [generatingImprovements, setGeneratingImprovements] = useState(false);
  const [improvementActionId, setImprovementActionId] = useState("");
  const [sleepSaving, setSleepSaving] = useState(false);
  const [sleepRunning, setSleepRunning] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<MemoryKind | "all">("all");
  const [statusFilter, setStatusFilter] = useState<MemoryStatus | "all">("active");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [draft, setDraft] = useState(DEFAULT_DRAFT);
  const [labDraft, setLabDraft] = useState(DEFAULT_LAB_DRAFT);
  const [labScanning, setLabScanning] = useState(false);
  const [labScan, setLabScan] = useState<CapabilityLabScan | null>(null);
  const [sleep, setSleep] = useState<SleepState | null>(null);
  const [sleepDraft, setSleepDraft] = useState<SleepDraft>({
    enabled: DEFAULT_SLEEP_CONFIG.enabled,
    time: DEFAULT_SLEEP_CONFIG.time,
    timezone: DEFAULT_SLEEP_CONFIG.timezone,
  });
  const sleepHydratedRef = useRef(false);
  const lastSavedSleepDraftRef = useRef("");
  const sleepSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      params.set("includeArchived", statusFilter === "all" ? "true" : "false");
      if (kindFilter !== "all") params.set("kind", kindFilter);
      if (query.trim()) params.set("q", query.trim());
      const [memoryRes, reflectionRes, sleepRes, improvementRes] = await Promise.all([
        fetch(`/api/memory-v2?${params.toString()}`, { cache: "no-store" }),
        fetch("/api/memory-v2/reflection", { cache: "no-store" }),
        fetch("/api/memory-v2/sleep", { cache: "no-store" }),
        fetch("/api/memory-v2/improvements?limit=20", { cache: "no-store" }),
      ]);
      if (!memoryRes.ok) throw new Error(await memoryRes.text());
      if (!reflectionRes.ok) throw new Error(await reflectionRes.text());
      if (!sleepRes.ok) throw new Error(await sleepRes.text());
      if (!improvementRes.ok) throw new Error(await improvementRes.text());
      const memoryJson = await memoryRes.json();
      const reflectionJson = await reflectionRes.json();
      const sleepJson = await sleepRes.json();
      const improvementJson = await improvementRes.json();
      const nextSleepDraft = {
        enabled: sleepJson.config?.enabled ?? DEFAULT_SLEEP_CONFIG.enabled,
        time: sleepJson.config?.time || DEFAULT_SLEEP_CONFIG.time,
        timezone: sleepJson.config?.timezone || DEFAULT_SLEEP_CONFIG.timezone,
      };
      setMemories(memoryJson.memories || []);
      setReport(reflectionJson.report || null);
      setSleep({ config: sleepJson.config || DEFAULT_SLEEP_CONFIG, runs: sleepJson.runs || [] });
      setImprovements(improvementJson.candidates || []);
      lastSavedSleepDraftRef.current = JSON.stringify(nextSleepDraft);
      sleepHydratedRef.current = true;
      setSleepDraft(nextSleepDraft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [kindFilter, query, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const active = memories.filter((item) => item.status === "active").length;
    const sensitive = memories.filter((item) => item.sensitivity !== "normal").length;
    const used = memories.reduce((sum, item) => sum + item.hitCount, 0);
    return { active, sensitive, used };
  }, [memories]);

  async function createMemory() {
    if (!draft.title.trim() || !draft.body.trim()) {
      setError("标题和内容不能为空");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/memory-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: draft.kind,
          scopeType: draft.scopeType,
          scopeKey: draft.scopeKey,
          title: draft.title,
          body: draft.body,
          tags: draft.tags.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean),
          importance: draft.importance,
          sensitivity: draft.sensitivity,
          secretRef: draft.secretRef,
          sourceType: "memory_v2_ui",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setDraft(DEFAULT_DRAFT);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function runReflection() {
    setReflecting(true);
    setError("");
    try {
      const res = await fetch("/api/memory-v2/reflection", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setReport(data.report || null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "自省失败");
    } finally {
      setReflecting(false);
    }
  }

  async function generateImprovements() {
    setGeneratingImprovements(true);
    setError("");
    try {
      const res = await fetch("/api/memory-v2/improvements", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setImprovements(data.candidates || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成改进候选失败");
    } finally {
      setGeneratingImprovements(false);
    }
  }

  async function sendImprovementToBuilder(candidate: ImprovementCandidate) {
    if (candidate.builderSessionId) {
      router.push(`/extensions?tab=builder&builderSessionId=${encodeURIComponent(candidate.builderSessionId)}`);
      return;
    }

    setImprovementActionId(candidate.id);
    setError("");
    try {
      const res = await fetch(`/api/memory-v2/improvements/${candidate.id}/builder-session`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "创建能力生成器会话失败");
      if (data.session?.id && data.prompt) {
        stashPendingChatBootstrap({
          sessionId: data.session.id,
          content: data.prompt,
        });
        router.push(`/extensions?tab=builder&builderSessionId=${encodeURIComponent(data.session.id)}`);
      } else {
        throw new Error("能力生成器会话返回不完整");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "交给能力生成器失败");
    } finally {
      setImprovementActionId("");
    }
  }

  async function scanCapabilityReference() {
    if (!labDraft.capabilityName.trim() || (!labDraft.content.trim() && (!labDraft.download || !labDraft.sourceUrl.trim()))) {
      setError("能力名称和参考内容不能为空；如需自动下载，请填写来源链接并启用下载");
      return;
    }
    setLabScanning(true);
    setError("");
    try {
      const res = await fetch("/api/memory-v2/capability-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capabilityType: labDraft.capabilityType,
          capabilityName: labDraft.capabilityName,
          sourceUrl: labDraft.sourceUrl || undefined,
          content: labDraft.content,
          download: labDraft.download,
          source: "memory-v2-ui",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "隔离扫描失败");
      setLabScan(data.scan || null);
      await generateImprovements();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "隔离扫描失败");
    } finally {
      setLabScanning(false);
    }
  }

  useEffect(() => {
    if (!sleepHydratedRef.current) return;
    const payload = JSON.stringify(sleepDraft);
    if (payload === lastSavedSleepDraftRef.current) return;
    if (sleepSaveTimerRef.current) {
      clearTimeout(sleepSaveTimerRef.current);
    }
    sleepSaveTimerRef.current = setTimeout(() => {
      const draftToSave = sleepDraft;
      setSleepSaving(true);
      setError("");
      fetch("/api/memory-v2/sleep", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftToSave),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(await res.text());
          return res.json();
        })
        .then((data) => {
          const nextSleepDraft = {
            enabled: data.config?.enabled ?? DEFAULT_SLEEP_CONFIG.enabled,
            time: data.config?.time || DEFAULT_SLEEP_CONFIG.time,
            timezone: data.config?.timezone || DEFAULT_SLEEP_CONFIG.timezone,
          };
          setSleep({ config: data.config || DEFAULT_SLEEP_CONFIG, runs: data.runs || [] });
          lastSavedSleepDraftRef.current = JSON.stringify(nextSleepDraft);
          setSleepDraft(nextSleepDraft);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "睡眠设置自动保存失败");
        })
        .finally(() => {
          setSleepSaving(false);
        });
    }, 650);

    return () => {
      if (sleepSaveTimerRef.current) {
        clearTimeout(sleepSaveTimerRef.current);
      }
    };
  }, [sleepDraft]);

  async function runSleepNow() {
    setSleepRunning(true);
    setError("");
    try {
      const res = await fetch("/api/memory-v2/sleep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "manual", force: true }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSleep({ config: data.config || DEFAULT_SLEEP_CONFIG, runs: data.runs || [] });
      setReport(data.run?.report || report);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "睡眠运行失败");
    } finally {
      setSleepRunning(false);
    }
  }

  const kindOptions = Object.keys(KIND_LABELS) as MemoryKind[];

  return (
    <main className="min-h-full bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-6 py-6">
        <section className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-2 inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Brain className="h-4 w-4" />
              Memory v2
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">行动记忆</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              围绕“把事情做好”记录任务、人/角色、资源、能力和复盘。业务原始数据仍留在各模块，记忆只保存会影响未来行动的上下文。
            </p>
          </div>
          <Button type="button" variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            刷新
          </Button>
        </section>

        <section className="grid gap-3 md:grid-cols-4">
          <Metric label="当前列表" value={memories.length} />
          <Metric label="生效记忆" value={stats.active} />
          <Metric label="敏感资源" value={stats.sensitive} />
          <Metric label="累计命中" value={stats.used} />
        </section>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        <section className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
          <div className="space-y-5">
            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">记忆自省</h2>
                <Badge variant="outline">{report?.stats.total ?? 0} 条</Badge>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                系统在每日睡眠时自动写入复盘记录，这里只展示最新健康状态。
              </p>
              <div className="mt-4 space-y-2">
                {report?.issues.length ? report.issues.slice(0, 8).map((issue) => (
                  <div key={issue.id} className={cn("rounded-md border px-3 py-2 text-xs", severityClass(issue.severity))}>
                    <div className="font-medium">{issue.title}</div>
                    <div className="mt-1 leading-5">{issue.detail}</div>
                  </div>
                )) : (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                    睡眠已完成，暂无需要自动修正的记忆问题。
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div>
                <h2 className="text-sm font-semibold">自我改进</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  睡眠会从能力账、复盘账、Skill/MCP 操作、第三方隔离研究和 MCP 调用结果里自动发现缺口。真正安装 Skill/MCP 前仍由能力生成器把关。
                </p>
              </div>
              <div className="mt-4 space-y-2">
                {improvements.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    暂无改进候选。系统会在睡眠时继续扫描对话、能力缺口、Skill/MCP 操作、第三方隔离研究和 MCP 调用结果。
                  </div>
                ) : improvements.slice(0, 6).map((candidate) => {
                  const busy = improvementActionId === candidate.id;
                  return (
                    <div key={candidate.id} className="rounded-md border border-border px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline">{IMPROVEMENT_TYPE_LABELS[candidate.candidateType]}</Badge>
                        <span className={cn("rounded-full border px-2 py-0.5 text-xs", improvementStatusClass(candidate.status))}>
                          {IMPROVEMENT_STATUS_LABELS[candidate.status]}
                        </span>
                        <span className={cn("rounded-full border px-2 py-0.5 text-xs", riskClass(candidate.riskLevel))}>
                          风险 {candidate.riskLevel === "high" ? "高" : candidate.riskLevel === "medium" ? "中" : "低"}
                        </span>
                      </div>
                      <div className="mt-2 text-sm font-medium leading-5">{candidate.title}</div>
                      <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{candidate.proposedCapability}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => void sendImprovementToBuilder(candidate)} disabled={busy}>
                          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="mr-1.5 h-3.5 w-3.5" />}
                          {candidate.builderSessionId ? "打开生成器" : "交给生成器"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">每日睡眠</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    自动完成对话提炼、Skill/MCP 操作、第三方隔离研究、调用复盘、记忆自省和能力缺口扫描。
                  </p>
                </div>
                <Badge variant={sleep?.config.enabled ? "secondary" : "outline"}>
                  {sleep?.config.enabled ? "已开启" : "已关闭"}
                </Badge>
              </div>
              <div className="mt-4 grid gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5" />
                  下次：{sleep?.config.nextRunLabel || "未计算"}
                </div>
                <div>最近运行：{formatTime(sleep?.config.lastRunAt)}</div>
              </div>
              <div className="mt-4 space-y-2">
                {(sleep?.runs || []).slice(0, 3).map((run) => (
                  <div key={run.id} className="rounded-md border border-border px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{run.triggerType === "daily" ? "自动" : "调试"} · {run.runDay}</span>
                      <span className={cn(
                        "rounded-full border px-2 py-0.5",
                        run.status === "success"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : run.status === "error"
                            ? "border-rose-200 bg-rose-50 text-rose-700"
                            : "border-zinc-200 bg-zinc-50 text-zinc-600",
                      )}>
                        {run.status === "success" ? "完成" : run.status === "error" ? "失败" : "跳过"}
                      </span>
                    </div>
                    <div className="mt-1 text-muted-foreground">{run.error || formatTime(run.completedAt)}</div>
                  </div>
                ))}
              </div>
            </section>

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="rounded-lg border border-dashed border-border bg-muted/20">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/40"
                >
                  <Settings2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">高级/调试</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">手动补录、调试运行和睡眠参数。</div>
                  </div>
                  <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", advancedOpen ? "rotate-180" : "")} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-4 border-t border-border p-4">
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">手动补录</h2>
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <LabeledSelect
                    label="类型"
                    value={draft.kind}
                    onChange={(value) => setDraft((prev) => ({ ...prev, kind: value as MemoryKind }))}
                    options={kindOptions.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }))}
                  />
                  <LabeledSelect
                    label="作用域"
                    value={draft.scopeType}
                    onChange={(value) => setDraft((prev) => ({
                      ...prev,
                      scopeType: value as ScopeType,
                      scopeKey: value === "user" ? "default" : value === "main_agent" ? "main" : prev.scopeKey,
                    }))}
                    options={[
                      { value: "user", label: "用户全局" },
                      { value: "main_agent", label: "主代理" },
                      { value: "project", label: "项目" },
                      { value: "session", label: "会话" },
                      { value: "module", label: "模块" },
                      { value: "entity", label: "对象" },
                    ]}
                  />
                </div>
                <Input
                  value={draft.scopeKey}
                  onChange={(event) => setDraft((prev) => ({ ...prev, scopeKey: event.target.value }))}
                  placeholder="scope key，例如 default、项目路径、workflow id"
                />
                <Input
                  value={draft.title}
                  onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                  placeholder="标题"
                />
                <Textarea
                  value={draft.body}
                  onChange={(event) => setDraft((prev) => ({ ...prev, body: event.target.value }))}
                  placeholder="记忆内容：背景、目标、资源边界、能力缺口、下次怎么做..."
                  className="min-h-28"
                />
                <Input
                  value={draft.tags}
                  onChange={(event) => setDraft((prev) => ({ ...prev, tags: event.target.value }))}
                  placeholder="标签，用空格或逗号分隔"
                />
                <div className="grid grid-cols-2 gap-2">
                  <LabeledSelect
                    label="敏感级别"
                    value={draft.sensitivity}
                    onChange={(value) => setDraft((prev) => ({ ...prev, sensitivity: value as Sensitivity }))}
                    options={[
                      { value: "normal", label: "普通" },
                      { value: "sensitive_ref", label: "敏感引用" },
                      { value: "secret_ref_required", label: "缺凭证" },
                    ]}
                  />
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    value={draft.importance}
                    onChange={(event) => setDraft((prev) => ({ ...prev, importance: Number(event.target.value) }))}
                    aria-label="重要度"
                  />
                </div>
                <Input
                  value={draft.secretRef}
                  onChange={(event) => setDraft((prev) => ({ ...prev, secretRef: event.target.value }))}
                  placeholder="secret_ref，可选，例如 secret://server/lumos-prod"
                />
                <Button type="button" className="w-full" onClick={createMemory} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                  写入调试记忆
                </Button>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">手动自省</h2>
                <Button type="button" size="sm" variant="outline" onClick={runReflection} disabled={reflecting || loading}>
                  {reflecting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Brain className="mr-1.5 h-3.5 w-3.5" />}
                  写入自省记录
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                用于调试每日睡眠会自动完成的复盘流程。
              </p>
              <div className="mt-4 space-y-2">
                {report?.issues.length ? report.issues.slice(0, 8).map((issue) => (
                  <div key={issue.id} className={cn("rounded-md border px-3 py-2 text-xs", severityClass(issue.severity))}>
                    <div className="font-medium">{issue.title}</div>
                    <div className="mt-1 leading-5">{issue.detail}</div>
                  </div>
                )) : (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                    暂无需要自动修正的记忆问题。
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div>
                <h2 className="text-sm font-semibold">第三方能力隔离扫描</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  粘贴第三方 Skill/MCP 参考内容，只写入隔离区并做静态扫描；不会安装、启用或执行。
                </p>
              </div>
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
                  <LabeledSelect
                    label="类型"
                    value={labDraft.capabilityType}
                    onChange={(value) => setLabDraft((prev) => ({ ...prev, capabilityType: value as CapabilityLabType }))}
                    options={[
                      { value: "skill", label: "Skill" },
                      { value: "mcp", label: "MCP" },
                    ]}
                  />
                  <Input
                    value={labDraft.capabilityName}
                    onChange={(event) => setLabDraft((prev) => ({ ...prev, capabilityName: event.target.value }))}
                    placeholder="能力名称，例如 memory-reflect"
                    aria-label="第三方能力名称"
                  />
                </div>
                <Input
                  value={labDraft.sourceUrl}
                  onChange={(event) => setLabDraft((prev) => ({ ...prev, sourceUrl: event.target.value }))}
                  placeholder="来源链接，可选；支持 GitHub / raw.githubusercontent.com / zip"
                />
                <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-xs">
                  <span className="leading-5 text-muted-foreground">
                    从来源链接下载到隔离区。只允许 GitHub / raw / codeload / gist 的 HTTPS 链接，不安装、不执行。
                  </span>
                  <Switch
                    checked={labDraft.download}
                    onCheckedChange={(checked) => setLabDraft((prev) => ({ ...prev, download: checked }))}
                    aria-label="启用第三方链接下载"
                  />
                </label>
                <Textarea
                  value={labDraft.content}
                  onChange={(event) => setLabDraft((prev) => ({ ...prev, content: event.target.value }))}
                  placeholder="粘贴第三方 SKILL.md、README、manifest 或 MCP 代码片段；启用链接下载时可留空"
                  className="min-h-32 font-mono text-xs"
                />
                <Button type="button" className="w-full" variant="outline" onClick={scanCapabilityReference} disabled={labScanning}>
                  {labScanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldAlert className="mr-2 h-4 w-4" />}
                  隔离保存并扫描
                </Button>
                {labScan && (
                  <div className="rounded-md border border-border px-3 py-3 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={cn("rounded-full border px-2 py-0.5", labVerdictClass(labScan.verdict))}>
                        {labVerdictLabel(labScan.verdict)}
                      </span>
                      <span className={cn("rounded-full border px-2 py-0.5", riskClass(labScan.riskLevel))}>
                        风险 {labScan.riskLevel === "high" ? "高" : labScan.riskLevel === "medium" ? "中" : "低"}
                      </span>
                      <Badge variant="outline">扫描 {labScan.filesScanned} 个文件</Badge>
                    </div>
                    {labScan.patterns.length > 0 && (
                      <div className="mt-2 text-muted-foreground">可学习：{labScan.patterns.join("；")}</div>
                    )}
                    {labScan.policy && (
                      <div className="mt-2 rounded border border-border bg-muted/30 px-2 py-1.5 leading-5">
                        <div className="font-medium">
                          安装门禁：{labScan.policy.installAllowed ? "允许进入安装前确认" : "禁止直装，需二开或补验收"}
                        </div>
                        {labScan.policy.blockedReasons.length > 0 && (
                          <div className="mt-1 text-rose-700">阻断：{labScan.policy.blockedReasons.slice(0, 3).join("；")}</div>
                        )}
                        {labScan.policy.missingAcceptance.length > 0 && (
                          <div className="mt-1 text-amber-700">待补：{labScan.policy.missingAcceptance.join("；")}</div>
                        )}
                      </div>
                    )}
                    <div className="mt-2 whitespace-pre-wrap leading-5 text-muted-foreground">{labScan.rewriteTarget}</div>
                    {labScan.findings.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        {labScan.findings.slice(0, 4).map((finding) => (
                          <div key={finding.id} className="rounded border border-border bg-muted/30 px-2 py-1.5">
                            <div className="font-medium">{finding.severity} · {finding.category} · {finding.filePath}</div>
                            <div className="mt-0.5 text-muted-foreground">{finding.message}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">能力缺口扫描</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    从能力账、复盘账、Skill/MCP 操作、第三方隔离研究和 MCP 调用结果里找缺口，交给能力生成器写 Skill 或 MCP。
                  </p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={generateImprovements} disabled={generatingImprovements}>
                  {generatingImprovements ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Hammer className="mr-1.5 h-3.5 w-3.5" />}
                  扫描能力缺口
                </Button>
              </div>
              <div className="mt-4 space-y-2">
                {improvements.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    暂无改进候选。先把能力缺口或失败复盘记录到记忆里。
                  </div>
                ) : improvements.slice(0, 6).map((candidate) => {
                  const busy = improvementActionId === candidate.id;
                  return (
                    <div key={candidate.id} className="rounded-md border border-border px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline">{IMPROVEMENT_TYPE_LABELS[candidate.candidateType]}</Badge>
                        <span className={cn("rounded-full border px-2 py-0.5 text-xs", improvementStatusClass(candidate.status))}>
                          {IMPROVEMENT_STATUS_LABELS[candidate.status]}
                        </span>
                        <span className={cn("rounded-full border px-2 py-0.5 text-xs", riskClass(candidate.riskLevel))}>
                          风险 {candidate.riskLevel === "high" ? "高" : candidate.riskLevel === "medium" ? "中" : "低"}
                        </span>
                      </div>
                      <div className="mt-2 text-sm font-medium leading-5">{candidate.title}</div>
                      <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{candidate.proposedCapability}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => void sendImprovementToBuilder(candidate)} disabled={busy}>
                          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="mr-1.5 h-3.5 w-3.5" />}
                          {candidate.builderSessionId ? "打开生成器" : "交给生成器"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">睡眠参数</h2>
                  <p className="mt-1 text-xs text-muted-foreground">改动后自动保存。</p>
                </div>
                <Switch
                  checked={sleepDraft.enabled}
                  onCheckedChange={(checked) => setSleepDraft((prev) => ({ ...prev, enabled: checked }))}
                  aria-label="启用每日睡眠"
                />
              </div>
              <div className="mt-4 grid grid-cols-[120px_minmax(0,1fr)] gap-2">
                <Input
                  type="time"
                  value={sleepDraft.time}
                  onChange={(event) => setSleepDraft((prev) => ({ ...prev, time: event.target.value }))}
                  aria-label="每日睡眠时间"
                />
                <Input
                  value={sleepDraft.timezone}
                  onChange={(event) => setSleepDraft((prev) => ({ ...prev, timezone: event.target.value }))}
                  aria-label="每日睡眠时区"
                />
              </div>
              <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5" />
                  下次：{sleep?.config.nextRunLabel || "未计算"}
                </div>
                <div>最近运行：{formatTime(sleep?.config.lastRunAt)}</div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>{sleepSaving ? "自动保存中..." : "已自动保存"}</span>
                <Button type="button" size="sm" variant="outline" onClick={runSleepNow} disabled={sleepRunning}>
                  {sleepRunning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Moon className="mr-1.5 h-3.5 w-3.5" />}
                  调试运行一次
                </Button>
              </div>
              <div className="mt-4 space-y-2">
                {(sleep?.runs || []).slice(0, 3).map((run) => (
                  <div key={run.id} className="rounded-md border border-border px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{run.triggerType === "daily" ? "自动" : "调试"} · {run.runDay}</span>
                      <span className={cn(
                        "rounded-full border px-2 py-0.5",
                        run.status === "success"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : run.status === "error"
                            ? "border-rose-200 bg-rose-50 text-rose-700"
                            : "border-zinc-200 bg-zinc-50 text-zinc-600",
                      )}>
                        {run.status === "success" ? "完成" : run.status === "error" ? "失败" : "跳过"}
                      </span>
                    </div>
                    <div className="mt-1 text-muted-foreground">{run.error || formatTime(run.completedAt)}</div>
                  </div>
                ))}
              </div>
            </section>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          <section className="min-w-0 space-y-4">
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 lg:flex-row lg:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、内容、标签、证据" className="pl-9" />
              </div>
              <LabeledSelect
                label="类型"
                value={kindFilter}
                onChange={(value) => setKindFilter(value as MemoryKind | "all")}
                compact
                options={[{ value: "all", label: "全部类型" }, ...kindOptions.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }))]}
              />
              <LabeledSelect
                label="状态"
                value={statusFilter}
                onChange={(value) => setStatusFilter(value as MemoryStatus | "all")}
                compact
                options={[
                  { value: "active", label: "生效" },
                  { value: "candidate", label: "候选" },
                  { value: "all", label: "全部" },
                ]}
              />
            </div>

            {loading ? (
              <div className="flex h-48 items-center justify-center rounded-lg border border-border text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                正在加载行动记忆...
              </div>
            ) : memories.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center text-sm text-muted-foreground">
                暂无匹配记忆。系统会在对话和睡眠中自动沉淀记忆，也可以在高级/调试里补录。
              </div>
            ) : (
              <div className="space-y-3">
                {memories.map((memory) => {
                  const Icon = KIND_ICONS[memory.kind];
                  return (
                    <Card key={memory.id} className="overflow-hidden">
                      <CardHeader className="space-y-3 pb-3">
                        <div className="flex flex-col gap-3">
                          <div className="min-w-0">
                            <CardTitle className="flex items-center gap-2 text-base">
                              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className="truncate">{memory.title}</span>
                            </CardTitle>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <Badge variant="outline">{KIND_LABELS[memory.kind]}</Badge>
                              <Badge variant="outline">{SCOPE_LABELS[memory.scopeType]} · {memory.scopeKey || "未绑定"}</Badge>
                              <span className={cn("rounded-full border px-2 py-0.5 text-xs", statusClass(memory.status))}>
                                {STATUS_LABELS[memory.status]}
                              </span>
                              {memory.sensitivity !== "normal" && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                                  <ShieldAlert className="h-3 w-3" />
                                  {memory.sensitivity === "secret_ref_required" ? "缺凭证" : "敏感资源"}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3 pt-0">
                        <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{memory.body}</p>
                        {memory.secretRef && (
                          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                            secret_ref: {memory.secretRef}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                          {memory.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>重要度 {memory.importance}/5</span>
                          <span>命中 {memory.hitCount} 次</span>
                          <span>更新 {formatTime(memory.updatedAt)}</span>
                          <span>最近使用 {formatTime(memory.lastUsedAt)}</span>
                        </div>
                        <div className="text-xs leading-5 text-muted-foreground">
                          <span className="font-medium text-foreground">定义：</span>
                          {KIND_HINTS[memory.kind]}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
  compact,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  compact?: boolean;
}) {
  return (
    <label className={cn("block", compact ? "min-w-32" : "")}>
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
