'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  CircleGauge,
  Code2,
  ExternalLink,
  FileText,
  GitCompareArrows,
  History,
  Info,
  LayoutPanelTop,
  ClipboardList,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';

import { AppBuilderChatPanel } from '@/components/app/builder/AppBuilderChatPanel';
import { DemoReviewBanner } from '@/components/app/builder/DemoReviewBanner';
import { DraftPreview } from '@/components/app/builder/DraftPreview';
import { RequirementsPanel } from '@/components/app/builder/RequirementsPanel';
import { InstallDialog } from '@/components/app/install-flow/InstallDialog';
import { BottomChatPanel } from '@/components/layout/BottomChatPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type {
  ConsentRequest,
  ConsentResponse,
  InstalledApp,
} from '@/lib/app/installer';
import {
  NATIVE_APP_SPEC_FILE,
  validateNativeGradeAppSpec,
} from '@/lib/app/builder/native-grade-spec';
import {
  buildNativeSpecReviewPatch,
  getNativeSpecReview,
  isNativeSpecReviewAcceptedForArtifact,
  nativeSpecReviewLabel,
  type NativeSpecReview,
} from '@/lib/app/builder/native-spec-review';
import type {
  BuilderArtifact,
  BuilderMessage,
  BuilderSession,
  BuilderStory,
  SessionStatus,
} from '@/lib/app/builder/session';
import { APP_BUILDER_TEMPLATES } from '@/lib/app/builder/templates';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<SessionStatus, string> = {
  gathering: '收集需求',
  generating: '生成草稿',
  demo_review: 'Demo 待确认',
  final_build: '完整开发',
  installed: '已安装',
  iterating: '继续迭代',
  failed: '失败',
};

interface InstallResponse {
  ok?: boolean;
  installed?: InstalledApp;
  selfCheck?: InstallSelfCheck;
  warnings?: unknown[];
  needsConsent?: boolean;
  request?: ConsentRequest;
  error?: string;
  message?: string;
  issues?: unknown[];
}

interface InstallSelfCheck {
  runId: string;
  status: 'success' | 'failed';
  summary: string;
  checked: string[];
  failures: string[];
}

interface RequiredCheck {
  key: string;
  label: string;
  done: boolean;
  detail: string;
}

interface NativeSpecView {
  artifactVersion: number;
  rawContent: string;
  summary: string;
  userVisibleScope: string[];
  statusStates: string[];
  acceptance: Array<{ id: string; label: string; howToVerify: string }>;
  outOfScope: string[];
  parseError?: string;
}

export default function AppBuilderPage(): React.ReactElement {
  const router = useRouter();
  const params = useParams<{ sessionId: string }>();
  const sessionId = params?.sessionId ?? '';

  const [session, setSession] = React.useState<BuilderSession | null>(null);
  const [messages, setMessages] = React.useState<BuilderMessage[]>([]);
  const [artifacts, setArtifacts] = React.useState<BuilderArtifact[]>([]);
  const [stories, setStories] = React.useState<BuilderStory[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = React.useState<string>('');
  const [error, setError] = React.useState<string | null>(null);

  const [installing, setInstalling] = React.useState(false);
  const [savingInfo, setSavingInfo] = React.useState(false);
  const [savingNonGoals, setSavingNonGoals] = React.useState(false);
  const [savingNativeSpec, setSavingNativeSpec] = React.useState(false);
  const [updatingNativeSpecReview, setUpdatingNativeSpecReview] = React.useState(false);
  const [confirmingDemo, setConfirmingDemo] = React.useState(false);
  const [creatingStory, setCreatingStory] = React.useState(false);
  const [savingStoryId, setSavingStoryId] = React.useState<string>('');
  const [basicInfoDraft, setBasicInfoDraft] = React.useState({
    appName: '',
    appDescription: '',
  });
  const [artifactVersions, setArtifactVersions] = React.useState<BuilderArtifact[]>([]);
  const [versionsLoading, setVersionsLoading] = React.useState(false);
  const [rollingBack, setRollingBack] = React.useState(false);
  const [pendingInstallRequest, setPendingInstallRequest] =
    React.useState<ConsentRequest | null>(null);
  const [lastInstalled, setLastInstalled] = React.useState<InstalledApp | null>(null);
  const [lastSelfCheck, setLastSelfCheck] = React.useState<InstallSelfCheck | null>(null);

  const refresh = React.useCallback(async () => {
    if (!sessionId) return;
    try {
      const [sRes, mRes, aRes, storiesRes] = await Promise.all([
        fetch(`/api/apps/builder/sessions/${sessionId}`),
        fetch(`/api/apps/builder/sessions/${sessionId}/messages`),
        fetch(`/api/apps/builder/sessions/${sessionId}/artifacts`),
        fetch(`/api/apps/builder/sessions/${sessionId}/stories`),
      ]);
      if (!sRes.ok) {
        const json = (await sRes.json()) as { error?: string };
        throw new Error(json.error ?? `${sRes.status}`);
      }
      const sJson = (await sRes.json()) as { session: BuilderSession };
      const mJson = (await mRes.json()) as { messages: BuilderMessage[] };
      const aJson = (await aRes.json()) as { artifacts: BuilderArtifact[] };
      const storyJson = storiesRes.ok
        ? await storiesRes.json() as { stories: BuilderStory[] }
        : { stories: [] };
      setSession(sJson.session);
      setMessages(mJson.messages ?? []);
      setArtifacts(aJson.artifacts ?? []);
      setStories(storyJson.stories ?? []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [sessionId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (!session) return;
    setBasicInfoDraft({
      appName: session.appName ?? '',
      appDescription: session.appDescription ?? '',
    });
  }, [session]);

  React.useEffect(() => {
    if (artifacts.length === 0) {
      setSelectedArtifactId('');
      return;
    }
    if (!artifacts.some((artifact) => artifact.id === selectedArtifactId)) {
      setSelectedArtifactId(artifacts[0].id);
    }
  }, [artifacts, selectedArtifactId]);

  const appName = session?.appName ?? '未命名应用';
  const description = session?.appDescription ?? '';
  const selectedArtifact =
    artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? artifacts[0];
  const nativeSpecReview = React.useMemo(
    () => getNativeSpecReview(session?.needsSummary),
    [session?.needsSummary],
  );
  const checks = React.useMemo(
    () => buildRequiredChecks(artifacts, nativeSpecReview),
    [artifacts, nativeSpecReview],
  );
  const installReady = checks.every((check) => check.done);
  const pageCount = artifacts.filter(
    (artifact) => artifact.filePath.startsWith('pages/') && artifact.filePath.endsWith('.json'),
  ).length;
  const isInstalled = !!session?.appId || !!lastInstalled;
  const statusLabel = session ? STATUS_LABEL[session.status] : '加载中';
  const nonGoals = React.useMemo(() => extractNonGoals(session?.needsSummary), [session?.needsSummary]);

  React.useEffect(() => {
    let cancelled = false;
    async function loadVersions() {
      if (!sessionId || !selectedArtifact?.filePath) {
        setArtifactVersions([]);
        return;
      }
      setVersionsLoading(true);
      try {
        const res = await fetch(
          `/api/apps/builder/sessions/${sessionId}/artifacts/versions?filePath=${encodeURIComponent(selectedArtifact.filePath)}`,
        );
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(json.error ?? '加载文件版本失败');
        }
        const json = (await res.json()) as { versions: BuilderArtifact[] };
        if (!cancelled) setArtifactVersions(json.versions ?? []);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setVersionsLoading(false);
      }
    }
    void loadVersions();
    return () => {
      cancelled = true;
    };
  }, [sessionId, selectedArtifact?.filePath, selectedArtifact?.version]);

  const handleRollbackArtifact = async (filePath: string) => {
    if (!sessionId || rollingBack) return;
    if (!window.confirm(`回滚 ${filePath} 到上一版？`)) return;
    setRollingBack(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/builder/sessions/${sessionId}/artifacts/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? '回滚失败');
      }
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRollingBack(false);
    }
  };

  const patchNeedsSummary = React.useCallback(async (
    nextSummary: Record<string, unknown>,
    savingSetter: React.Dispatch<React.SetStateAction<boolean>>,
  ) => {
    if (!sessionId || !session) return;
    savingSetter(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/builder/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          needsSummary: {
            ...(session.needsSummary ?? {}),
            ...nextSummary,
          },
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? '保存失败');
      }
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      savingSetter(false);
    }
  }, [refresh, session, sessionId]);

  const handleSaveBasicInfo = React.useCallback(() => {
    void patchNeedsSummary({
      appName: basicInfoDraft.appName.trim() || '未命名应用',
      appDescription: basicInfoDraft.appDescription.trim(),
    }, setSavingInfo);
  }, [basicInfoDraft.appDescription, basicInfoDraft.appName, patchNeedsSummary]);

  const handleChangeNonGoals = React.useCallback((next: string[]) => {
    void patchNeedsSummary({ nonGoals: next }, setSavingNonGoals);
  }, [patchNeedsSummary]);

  const handleSaveNativeSpec = React.useCallback(async (content: string): Promise<boolean> => {
    if (!sessionId || !session || savingNativeSpec) return false;
    const issues = validateNativeGradeAppSpec(new Map([[NATIVE_APP_SPEC_FILE, content]]));
    if (issues.length > 0) {
      setError(formatNativeSpecIssues(issues));
      return false;
    }

    setSavingNativeSpec(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/builder/sessions/${sessionId}/artifacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: NATIVE_APP_SPEC_FILE,
          content: `${JSON.stringify(JSON.parse(content), null, 2)}\n`,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        artifact?: BuilderArtifact;
        error?: string;
        issues?: ReturnType<typeof validateNativeGradeAppSpec>;
      };
      if (!res.ok || !json.artifact) {
        const detail = Array.isArray(json.issues) && json.issues.length > 0
          ? `：${formatNativeSpecIssues(json.issues)}`
          : '';
        throw new Error(`${json.error ?? '保存规格失败'}${detail}`);
      }

      const patchRes = await fetch(`/api/apps/builder/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          needsSummary: {
            ...(session.needsSummary ?? {}),
            ...buildNativeSpecReviewPatch({
              status: 'pending',
              artifactVersion: json.artifact.version,
              note: '规格已编辑，等待用户接受。',
            }),
          },
        }),
      });
      if (!patchRes.ok) {
        const patchJson = (await patchRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(patchJson.error ?? '保存规格确认状态失败');
      }

      await refresh();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setSavingNativeSpec(false);
    }
  }, [refresh, savingNativeSpec, session, sessionId]);

  const handleAcceptNativeSpec = React.useCallback(async (): Promise<boolean> => {
    if (!sessionId || !session || updatingNativeSpecReview) return false;
    const artifact = artifacts.find((item) => item.filePath === NATIVE_APP_SPEC_FILE);
    if (!artifact) {
      setError('还没有生成 native-app-spec.json，无法接受规格。');
      return false;
    }
    const issues = validateNativeGradeAppSpec(new Map([[NATIVE_APP_SPEC_FILE, artifact.content]]));
    if (issues.length > 0) {
      setError(formatNativeSpecIssues(issues));
      return false;
    }

    setUpdatingNativeSpecReview(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/builder/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          needsSummary: {
            ...(session.needsSummary ?? {}),
            ...buildNativeSpecReviewPatch({
              status: 'accepted',
              artifactVersion: artifact.version,
              note: '用户已接受内置级应用规格。',
            }),
          },
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? '接受规格失败');
      }
      await refresh();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setUpdatingNativeSpecReview(false);
    }
  }, [artifacts, refresh, session, sessionId, updatingNativeSpecReview]);

  const handleRequestNativeSpecChanges = React.useCallback(async (): Promise<boolean> => {
    if (!sessionId || !session || updatingNativeSpecReview) return false;
    const artifact = artifacts.find((item) => item.filePath === NATIVE_APP_SPEC_FILE);
    setUpdatingNativeSpecReview(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/builder/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          needsSummary: {
            ...(session.needsSummary ?? {}),
            ...buildNativeSpecReviewPatch({
              status: 'needs_changes',
              artifactVersion: artifact?.version,
              note: '用户标记规格需要修改。',
            }),
          },
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? '标记规格需修改失败');
      }
      await refresh();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setUpdatingNativeSpecReview(false);
    }
  }, [artifacts, refresh, session, sessionId, updatingNativeSpecReview]);

  const handleConfirmDemo = React.useCallback(async () => {
    if (!sessionId || confirmingDemo) return;
    setConfirmingDemo(true);
    setError(null);
    try {
      const patchRes = await fetch(`/api/apps/builder/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'final_build' }),
      });
      if (!patchRes.ok) {
        const json = (await patchRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? '确认 Demo 失败');
      }

      const lookupRes = await fetch(
        `/api/apps/builder/chat/session?builderSessionId=${encodeURIComponent(sessionId)}`,
      );
      if (lookupRes.ok) {
        const lookupJson = (await lookupRes.json()) as {
          session?: { id?: string; provider_id?: string; model?: string } | null;
        };
        const chat = lookupJson.session;
        if (chat?.id) {
          const streamRes = await fetch(
            `/api/apps/builder/sessions/${sessionId}/chat/stream`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: '我已经确认 Demo，请按 SOP 6c 进入完整开发阶段，把所有 confirmed Story 增量补完。',
                session_id: chat.id,
                provider_id: chat.provider_id || undefined,
                model: chat.model || undefined,
              }),
            },
          );
          if (streamRes.body) {
            const reader = streamRes.body.getReader();
            while (true) {
              const { done } = await reader.read();
              if (done) break;
            }
          }
        }
      }

      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConfirmingDemo(false);
    }
  }, [confirmingDemo, refresh, sessionId]);

  const handleCreateStory = React.useCallback(async () => {
    if (!sessionId || creatingStory) return;
    setCreatingStory(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/builder/sessions/${sessionId}/stories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '新的用户故事',
          storyText: '作为用户，我希望完成一个明确任务，这样我能获得可验证的结果。',
          status: 'draft',
          priority: 2,
          acceptanceCriteria: ['用户可以在界面上完成这个任务'],
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? '新增 Story 失败');
      }
      const json = await res.json() as { story: BuilderStory };
      setStories((current) => [...current, json.story]);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreatingStory(false);
    }
  }, [creatingStory, refresh, sessionId]);

  const handleChangeStoryDraft = React.useCallback((
    storyId: string,
    patch: Partial<BuilderStory>,
  ) => {
    setStories((current) => current.map((story) => (
      story.id === storyId ? { ...story, ...patch } : story
    )));
  }, []);

  const handleSaveStory = React.useCallback(async (story: BuilderStory) => {
    if (!sessionId || savingStoryId) return;
    setSavingStoryId(story.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/apps/builder/sessions/${sessionId}/stories/${story.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: story.title,
            storyText: story.storyText,
            actor: story.actor ?? null,
            goal: story.goal ?? null,
            benefit: story.benefit ?? null,
            status: story.status,
            priority: story.priority,
            acceptanceCriteria: story.acceptanceCriteria,
            relatedPages: story.relatedPages,
            relatedCollections: story.relatedCollections,
          }),
        },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? '保存 Story 失败');
      }
      const json = await res.json() as { story: BuilderStory };
      setStories((current) => current.map((item) => (
        item.id === story.id ? json.story : item
      )));
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingStoryId('');
    }
  }, [refresh, savingStoryId, sessionId]);

  const handleDeleteStory = React.useCallback(async (storyId: string) => {
    if (!sessionId) return;
    if (!window.confirm('删除这条 Story？')) return;
    setSavingStoryId(storyId);
    setError(null);
    try {
      const res = await fetch(
        `/api/apps/builder/sessions/${sessionId}/stories/${storyId}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? '删除 Story 失败');
      }
      setStories((current) => current.filter((story) => story.id !== storyId));
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingStoryId('');
    }
  }, [refresh, sessionId]);

  const performInstall = async (consent: ConsentResponse | null) => {
    if (!sessionId || installing) return;
    setInstalling(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/builder/sessions/${sessionId}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(consent ? { consent } : {}),
      });
      const json = (await res.json()) as InstallResponse;
      if (json.needsConsent && json.request) {
        setPendingInstallRequest(json.request);
        return;
      }
      if (!res.ok || json.ok === false || !json.installed) {
        setError(formatInstallError(json));
        return;
      }
      setPendingInstallRequest(null);
      setLastInstalled(json.installed);
      setLastSelfCheck(json.selfCheck ?? null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInstalling(false);
    }
  };

  const handleDeleteDraft = async () => {
    if (!sessionId) return;
    if (!window.confirm('删除这个草稿？相关对话与文件也会一并丢弃。')) return;
    const res = await fetch(`/api/apps/builder/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      router.push('/apps');
    } else {
      const json = (await res.json()) as { error?: string };
      window.alert(`删除失败：${json.error ?? '未知错误'}`);
    }
  };

  if (error && !session) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" asChild className="mt-4">
          <Link href="/apps">返回应用列表</Link>
        </Button>
      </div>
    );
  }

  if (!session) {
    return <div className="p-6 text-sm text-muted-foreground">加载中…</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex min-h-12 items-center gap-3 border-b px-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/apps">
            <ArrowLeft data-icon="inline-start" />
            返回
          </Link>
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold">{appName}</h1>
            <Badge variant={isInstalled ? 'secondary' : 'outline'}>
              {isInstalled ? '已安装' : `${statusLabel} · 草稿`}
            </Badge>
          </div>
          {description ? (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{description}</div>
          ) : null}
        </div>
        {isInstalled && (session.appId || lastInstalled?.appId) ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/apps/${session.appId ?? lastInstalled?.appId}`}>
              <ExternalLink data-icon="inline-start" />
              打开应用
            </Link>
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => void performInstall(null)}
            disabled={!installReady || installing}
          >
            <Sparkles data-icon="inline-start" />
            {installing ? '安装中…' : '保存并安装'}
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={handleDeleteDraft} aria-label="删除草稿">
          <Trash2 />
        </Button>
      </header>

      {lastSelfCheck ? (
        <div
          className={cn(
            'border-b px-4 py-2 text-xs',
            lastSelfCheck.status === 'success'
              ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100'
              : 'bg-destructive/10 text-destructive',
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            {lastSelfCheck.status === 'success' ? (
              <CheckCircle2 className="size-4 shrink-0" />
            ) : (
              <AlertTriangle className="size-4 shrink-0" />
            )}
            <span className="font-medium">
              {lastSelfCheck.status === 'success' ? '安装自检通过' : '安装自检失败'}
            </span>
            <span className="min-w-0 flex-1">{lastSelfCheck.summary}</span>
            {lastSelfCheck.status === 'failed' && lastSelfCheck.failures[0] ? (
              <span className="basis-full pl-6">
                失败项：{lastSelfCheck.failures[0]}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 bg-muted/20">
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {session.status === 'demo_review' ? (
            <DemoReviewBanner
              confirming={confirmingDemo}
              onConfirm={() => void handleConfirmDemo()}
            />
          ) : null}
          <Tabs defaultValue="preview" className="flex min-h-0 flex-1 flex-col gap-0">
            <div className="flex min-h-10 items-center justify-between gap-4 border-b bg-background px-4">
              <TabsList className="max-w-full overflow-x-auto">
                <TabsTrigger value="preview">
                  <LayoutPanelTop />
                  预览
                </TabsTrigger>
                <TabsTrigger value="code">
                  <Code2 />
                  代码
                </TabsTrigger>
                <TabsTrigger value="requirements">
                  <ClipboardList />
                  需求
                </TabsTrigger>
                <TabsTrigger value="project-status">
                  <CircleGauge />
                  项目状态
                </TabsTrigger>
                <TabsTrigger value="details">
                  <Info />
                  详情
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="preview" className="min-h-0 flex-1 overflow-hidden">
              <DraftPreview
                artifacts={artifacts}
                appName={appName}
                description={description}
                sessionId={sessionId}
              />
            </TabsContent>

            <TabsContent value="code" className="min-h-0 flex-1 overflow-hidden">
              <CodePanel
                artifacts={artifacts}
                selectedArtifact={selectedArtifact}
                versions={artifactVersions}
                versionsLoading={versionsLoading}
                rollingBack={rollingBack}
                onSelectArtifact={setSelectedArtifactId}
                onRollbackArtifact={handleRollbackArtifact}
              />
            </TabsContent>

            <TabsContent value="requirements" className="min-h-0 flex-1 overflow-hidden">
              <RequirementsPanel
                stories={stories}
                creating={creatingStory}
                savingStoryId={savingStoryId}
                nonGoals={nonGoals}
                savingNonGoals={savingNonGoals}
                onCreateStory={handleCreateStory}
                onChangeStory={handleChangeStoryDraft}
                onSaveStory={handleSaveStory}
                onDeleteStory={handleDeleteStory}
                onChangeNonGoals={handleChangeNonGoals}
              />
            </TabsContent>

            <TabsContent value="project-status" className="min-h-0 flex-1 overflow-hidden">
              <ProjectStatusPanel
                session={session}
                statusLabel={statusLabel}
                isInstalled={isInstalled}
                artifacts={artifacts}
                checks={checks}
                pageCount={pageCount}
                messageCount={messages.length}
                nativeSpecReview={nativeSpecReview}
                savingNativeSpec={savingNativeSpec}
                updatingNativeSpecReview={updatingNativeSpecReview}
                onSaveNativeSpec={handleSaveNativeSpec}
                onAcceptNativeSpec={handleAcceptNativeSpec}
                onRequestNativeSpecChanges={handleRequestNativeSpecChanges}
              />
            </TabsContent>

            <TabsContent value="details" className="min-h-0 flex-1 overflow-hidden">
              <DetailsPanel
                session={session}
                draft={basicInfoDraft}
                saving={savingInfo}
                statusLabel={statusLabel}
                appId={session.appId ?? lastInstalled?.appId}
                onDraftChange={setBasicInfoDraft}
                onSave={handleSaveBasicInfo}
              />
            </TabsContent>
          </Tabs>
        </main>
      </div>

      <BottomChatPanel title="应用开发助手">
        {({ collapsed, expand }) => (
          <AppBuilderChatPanel
            builderSessionId={sessionId}
            compactInputOnly={collapsed}
            onInputFocus={expand}
            fullWidth
            hideEmptyState
            onTurnComplete={() => void refresh()}
          />
        )}
      </BottomChatPanel>

      {error ? (
        <div className="border-t bg-destructive/10 px-6 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <InstallDialog
        open={pendingInstallRequest !== null}
        request={pendingInstallRequest}
        onConfirm={(response) => void performInstall(response)}
        onCancel={() => {
          setPendingInstallRequest(null);
          setInstalling(false);
        }}
      />
    </div>
  );
}

function CodePanel({
  artifacts,
  selectedArtifact,
  versions,
  versionsLoading,
  rollingBack,
  onSelectArtifact,
  onRollbackArtifact,
}: {
  artifacts: BuilderArtifact[];
  selectedArtifact?: BuilderArtifact;
  versions: BuilderArtifact[];
  versionsLoading: boolean;
  rollingBack: boolean;
  onSelectArtifact: (id: string) => void;
  onRollbackArtifact: (filePath: string) => void;
}): React.ReactElement {
  if (artifacts.length === 0) {
    return (
      <div className="p-6">
        <EmptyPanel title="还没有生成代码" description="在底部和应用开发助手对话后，生成的应用文件会显示在这里。" />
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[260px_minmax(0,1fr)] bg-background">
      <ScrollArea className="border-r">
        <div className="flex flex-col gap-1 p-3">
          {artifacts.map((artifact) => (
            <button
              key={artifact.id}
              type="button"
              className={cn(
                'rounded-md px-3 py-2 text-left hover:bg-muted',
                selectedArtifact?.id === artifact.id && 'bg-muted',
              )}
              onClick={() => onSelectArtifact(artifact.id)}
            >
              <div className="truncate font-mono text-xs font-medium">
                {artifact.filePath}
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span>v{artifact.version}</span>
                <span>{artifact.status}</span>
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>
      {selectedArtifact ? (
        <div className="flex min-h-0 flex-col">
          <div className="flex h-10 items-center justify-between border-b px-4">
            <div className="truncate font-mono text-xs font-medium">
              {selectedArtifact.filePath}
            </div>
            <Badge variant="outline">v{selectedArtifact.version}</Badge>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <pre className="min-h-full overflow-auto bg-muted/20 p-4 font-mono text-xs leading-relaxed">
              {formatArtifactContent(selectedArtifact.content)}
            </pre>
          </ScrollArea>
          <VersionComparePanel
            current={selectedArtifact}
            previous={findPreviousVersion(selectedArtifact, versions)}
            versions={versions}
            loading={versionsLoading}
            rollingBack={rollingBack}
            onRollback={() => onRollbackArtifact(selectedArtifact.filePath)}
          />
        </div>
      ) : null}
    </div>
  );
}

function VersionComparePanel({
  current,
  previous,
  versions,
  loading,
  rollingBack,
  onRollback,
}: {
  current: BuilderArtifact;
  previous?: BuilderArtifact;
  versions: BuilderArtifact[];
  loading: boolean;
  rollingBack: boolean;
  onRollback: () => void;
}): React.ReactElement {
  return (
    <div className="border-t bg-background">
      <div className="flex min-h-10 items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <History className="size-3.5" />
          {loading ? '正在加载版本…' : `${versions.length} 个历史版本`}
          {previous ? (
            <>
              <GitCompareArrows className="size-3.5" />
              <span>当前 v{current.version} / 上一版 v{previous.version}</span>
            </>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!previous || rollingBack}
          onClick={onRollback}
        >
          <RotateCcw data-icon="inline-start" />
          {rollingBack ? '回滚中…' : '回滚上一版'}
        </Button>
      </div>
      {previous ? (
        <div className="grid max-h-64 grid-cols-2 overflow-hidden border-t text-xs">
          <div className="min-w-0 border-r">
            <div className="border-b bg-muted/30 px-3 py-2 font-mono">
              上一版 v{previous.version}
            </div>
            <ScrollArea className="h-52">
              <pre className="p-3 font-mono leading-relaxed">
                {formatArtifactContent(previous.content)}
              </pre>
            </ScrollArea>
          </div>
          <div className="min-w-0">
            <div className="border-b bg-muted/30 px-3 py-2 font-mono">
              当前 v{current.version}
            </div>
            <ScrollArea className="h-52">
              <pre className="p-3 font-mono leading-relaxed">
                {formatArtifactContent(current.content)}
              </pre>
            </ScrollArea>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DetailsPanel({
  session,
  draft,
  saving,
  statusLabel,
  appId,
  onDraftChange,
  onSave,
}: {
  session: BuilderSession;
  draft: { appName: string; appDescription: string };
  saving: boolean;
  statusLabel: string;
  appId?: string;
  onDraftChange: React.Dispatch<React.SetStateAction<{ appName: string; appDescription: string }>>;
  onSave: () => void;
}): React.ReactElement {
  return (
    <ScrollArea className="h-full bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-base font-semibold">应用基本信息</div>
            <div className="mt-1 text-xs text-muted-foreground">
              这些信息会用于应用列表、标题和安装后的应用入口。
            </div>
          </div>
          <Button size="sm" onClick={onSave} disabled={saving}>
            <Save data-icon="inline-start" />
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>

        <div className="grid gap-4 rounded-lg border bg-background p-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">应用名</span>
            <Input
              value={draft.appName}
              onChange={(event) => onDraftChange((current) => ({
                ...current,
                appName: event.target.value,
              }))}
              placeholder="例如：客户管理"
              maxLength={64}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">描述</span>
            <Textarea
              value={draft.appDescription}
              onChange={(event) => onDraftChange((current) => ({
                ...current,
                appDescription: event.target.value,
              }))}
              placeholder="一句话说明这个应用做什么、给谁用。"
              className="min-h-24"
              maxLength={500}
            />
          </label>
          <div className="grid gap-3 border-t pt-4 text-sm md:grid-cols-2">
            <InfoRow label="起点" value={templateLabel(session.templateId)} />
            <InfoRow label="状态" value={statusLabel} />
            <InfoRow label="会话 ID" value={session.id} mono />
            {appId ? <InfoRow label="已安装应用" value={appId} mono /> : null}
            <InfoRow label="最近更新" value={formatTime(session.updatedAt)} />
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}


function ProjectStatusPanel({
  session,
  statusLabel,
  isInstalled,
  artifacts,
  checks,
  pageCount,
  messageCount,
  nativeSpecReview,
  savingNativeSpec,
  updatingNativeSpecReview,
  onSaveNativeSpec,
  onAcceptNativeSpec,
  onRequestNativeSpecChanges,
}: {
  session: BuilderSession;
  statusLabel: string;
  isInstalled: boolean;
  artifacts: BuilderArtifact[];
  checks: RequiredCheck[];
  pageCount: number;
  messageCount: number;
  nativeSpecReview: NativeSpecReview;
  savingNativeSpec: boolean;
  updatingNativeSpecReview: boolean;
  onSaveNativeSpec: (content: string) => Promise<boolean>;
  onAcceptNativeSpec: () => Promise<boolean>;
  onRequestNativeSpecChanges: () => Promise<boolean>;
}): React.ReactElement {
  const nativeSpec = parseNativeSpecArtifact(artifacts);

  return (
    <ScrollArea className="h-full bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6">
        <div className="grid gap-3 text-sm md:grid-cols-4">
          <StatusMetric label="当前状态" value={statusLabel} />
          <StatusMetric label="页面" value={`${pageCount}`} />
          <StatusMetric label="文件" value={`${artifacts.length}`} />
          <StatusMetric label="对话" value={`${messageCount}`} />
        </div>

        <section className="grid gap-3 rounded-lg border bg-background p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">安装状态</div>
            <Badge variant={isInstalled ? 'secondary' : 'outline'}>
              {isInstalled ? '已安装' : '草稿'}
            </Badge>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {checks.map((check) => (
              <div key={check.key} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{check.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{check.detail}</div>
                </div>
                <Badge variant={check.done ? 'secondary' : 'outline'}>
                  {check.done ? '已具备' : '缺少'}
                </Badge>
              </div>
            ))}
          </div>
        </section>

        <NativeSpecPanel
          spec={nativeSpec}
          review={nativeSpecReview}
          saving={savingNativeSpec}
          updatingReview={updatingNativeSpecReview}
          onSave={onSaveNativeSpec}
          onAccept={onAcceptNativeSpec}
          onRequestChanges={onRequestNativeSpecChanges}
        />

        <section className="grid gap-3 rounded-lg border bg-background p-4">
          <div className="text-sm font-semibold">文件概览</div>
          {artifacts.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2">
              {artifacts.map((artifact) => (
                <div key={artifact.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs">{artifact.filePath}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      v{artifact.version} · {artifact.status}
                    </div>
                  </div>
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              还没有生成应用文件。
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            最近更新：{formatTime(session.updatedAt)}
          </div>
        </section>
      </div>
    </ScrollArea>
  );
}

function NativeSpecPanel({
  spec,
  review,
  saving,
  updatingReview,
  onSave,
  onAccept,
  onRequestChanges,
}: {
  spec: NativeSpecView | null;
  review: NativeSpecReview;
  saving: boolean;
  updatingReview: boolean;
  onSave: (content: string) => Promise<boolean>;
  onAccept: () => Promise<boolean>;
  onRequestChanges: () => Promise<boolean>;
}): React.ReactElement {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(spec?.rawContent ?? buildNativeSpecDraft());
  const [localError, setLocalError] = React.useState('');
  const acceptedForCurrentSpec = isNativeSpecAcceptedForCurrentArtifact(spec, review);
  const reviewIsStale = review.status === 'accepted' && spec !== null && !acceptedForCurrentSpec;
  const acceptedAtMs = review.acceptedAt ? Date.parse(review.acceptedAt) : NaN;
  const reviewLabel = !spec
    ? '缺少'
    : spec.parseError
      ? '需修复'
      : reviewIsStale
        ? '待重新确认'
        : nativeSpecReviewLabel(review.status);
  const canAccept = !!spec
    && !spec.parseError
    && !acceptedForCurrentSpec
    && !saving
    && !updatingReview;

  React.useEffect(() => {
    if (editing) return;
    setDraft(spec?.rawContent ?? buildNativeSpecDraft());
    setLocalError('');
  }, [editing, spec?.rawContent]);

  const handleStartEdit = React.useCallback(() => {
    setDraft(spec?.rawContent ?? buildNativeSpecDraft());
    setLocalError('');
    setEditing(true);
  }, [spec?.rawContent]);

  const handleSave = React.useCallback(async () => {
    const issues = validateNativeGradeAppSpec(new Map([[NATIVE_APP_SPEC_FILE, draft]]));
    if (issues.length > 0) {
      setLocalError(formatNativeSpecIssues(issues));
      return;
    }
    const ok = await onSave(draft);
    if (ok) {
      setEditing(false);
      setLocalError('');
    }
  }, [draft, onSave]);

  const handleAccept = React.useCallback(async () => {
    const ok = await onAccept();
    if (ok) setLocalError('');
  }, [onAccept]);

  const handleRequestChanges = React.useCallback(async () => {
    const ok = await onRequestChanges();
    if (ok) setLocalError('');
  }, [onRequestChanges]);

  return (
    <section className="grid gap-3 rounded-lg border bg-background p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">内置级规格</div>
          <div className="mt-1 text-xs text-muted-foreground">
            这里确认生成应用的用户可验收范围、状态覆盖和验收清单。接受后才开放保存并安装。
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={acceptedForCurrentSpec ? 'secondary' : 'outline'}>
            {reviewLabel}
          </Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleStartEdit}
            disabled={saving || updatingReview}
          >
            <FileText data-icon="inline-start" />
            {spec ? '编辑规格' : '新建规格'}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleAccept()}
            disabled={!canAccept}
          >
            <CheckCircle2 data-icon="inline-start" />
            接受规格
          </Button>
        </div>
      </div>

      <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground md:grid-cols-[120px_1fr]">
        <div className="font-medium text-foreground">确认状态</div>
        <div className="grid gap-1">
          <div>
            {acceptedForCurrentSpec
              ? `用户已接受当前 v${spec?.artifactVersion ?? '-'} 规格。`
              : reviewIsStale
                ? `已接受的是 v${review.artifactVersion ?? '-'}，当前规格已更新，需要重新接受。`
                : review.status === 'needs_changes'
                  ? '用户已标记规格需要修改，安装前需要重新编辑并接受。'
                  : '规格还没有被用户接受，安装入口会保持关闭。'}
          </div>
          {Number.isFinite(acceptedAtMs) ? <div>接受时间：{formatTime(acceptedAtMs)}</div> : null}
          {review.note ? <div>备注：{review.note}</div> : null}
        </div>
      </div>

      {editing ? (
        <div className="grid gap-3 rounded-md border p-3">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-[360px] font-mono text-xs leading-5"
            spellCheck={false}
          />
          {localError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs leading-5 text-destructive">
              {localError}
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(spec?.rawContent ?? buildNativeSpecDraft());
                setLocalError('');
              }}
              disabled={saving}
            >
              <RotateCcw data-icon="inline-start" />
              重置
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(false);
                setLocalError('');
              }}
              disabled={saving}
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              <Save data-icon="inline-start" />
              {saving ? '保存中…' : '保存规格'}
            </Button>
          </div>
        </div>
      ) : !spec ? (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          还没有生成 native-app-spec.json。内置级应用需要先生成规格，明确状态、设置、运行结果、风险边界和验收清单。
        </div>
      ) : spec.parseError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {spec.parseError}
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="text-sm font-medium">{spec.summary}</div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="grid gap-2 rounded-md border p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                用户可验收范围
              </div>
              <ul className="grid gap-1.5 text-sm">
                {spec.userVisibleScope.slice(0, 5).map((item, index) => (
                  <li key={`${index}-${item}`} className="leading-6">
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid gap-2 rounded-md border p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                状态覆盖
              </div>
              <div className="flex flex-wrap gap-1.5">
                {spec.statusStates.map((state) => (
                  <Badge key={state} variant="outline" className="font-mono">
                    {state}
                  </Badge>
                ))}
              </div>
              {spec.outOfScope.length > 0 ? (
                <div className="pt-2 text-xs text-muted-foreground">
                  不做：{spec.outOfScope.slice(0, 3).join('、')}
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-2 rounded-md border p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              验收清单
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {spec.acceptance.slice(0, 8).map((item) => (
                <div key={item.id} className="rounded-md border bg-background px-3 py-2">
                  <div className="text-sm font-medium">{item.label}</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    {item.howToVerify}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!editing && spec && !spec.parseError && !acceptedForCurrentSpec ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleRequestChanges()}
            disabled={updatingReview}
          >
            标记需修改
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function StatusMetric({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="text-base font-semibold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function templateLabel(templateId?: string): string {
  if (!templateId) return '空白应用';
  return APP_BUILDER_TEMPLATES.find((template) => template.id === templateId)?.name ?? templateId;
}

function EmptyPanel({
  title,
  description,
}: {
  title: string;
  description: string;
}): React.ReactElement {
  return (
    <Card className="border-dashed">
      <CardContent className="p-8">
        <div className="text-base font-medium">{title}</div>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3">
      <div className="text-muted-foreground">{label}</div>
      <div className={cn('min-w-0 break-words', mono && 'font-mono text-xs')}>{value}</div>
    </div>
  );
}

function buildRequiredChecks(
  artifacts: BuilderArtifact[],
  nativeSpecReview: NativeSpecReview,
): RequiredCheck[] {
  const paths = new Set(artifacts.map((artifact) => artifact.filePath));
  const nativeSpec = parseNativeSpecArtifact(artifacts);
  const hasPage = artifacts.some(
    (artifact) => artifact.filePath.startsWith('pages/') && artifact.filePath.endsWith('.json'),
  );
  const nativeSpecAccepted = isNativeSpecAcceptedForCurrentArtifact(
    nativeSpec?.parseError ? null : nativeSpec,
    nativeSpecReview,
  );
  return [
    {
      key: 'manifest',
      label: '应用清单',
      done: paths.has('app.json'),
      detail: '包含应用名、版本、入口和权限声明。',
    },
    {
      key: 'routes',
      label: '页面路由',
      done: paths.has('routes.json'),
      detail: '定义左侧菜单和默认打开页面。',
    },
    {
      key: 'native-spec',
      label: '内置级规格',
      done: paths.has(NATIVE_APP_SPEC_FILE),
      detail: '说明状态、设置、运行结果、风险边界和验收清单。',
    },
    {
      key: 'native-spec-review',
      label: '规格确认',
      done: nativeSpecAccepted,
      detail: '用户已在项目状态页接受当前规格，才允许保存并安装。',
    },
    {
      key: 'pages',
      label: '至少一个页面',
      done: hasPage,
      detail: '用于正式渲染表单、列表、结果或内容页。',
    },
    {
      key: 'data',
      label: '数据结构',
      done: paths.has('data-schema.json'),
      detail: '让本地数据写入和预览 mock 数据有明确字段。',
    },
  ];
}

function parseNativeSpecArtifact(artifacts: BuilderArtifact[]): NativeSpecView | null {
  const artifact = artifacts.find((item) => item.filePath === NATIVE_APP_SPEC_FILE);
  if (!artifact) return null;
  try {
    const parsed = JSON.parse(artifact.content) as {
      summary?: unknown;
      userVisibleScope?: unknown;
      status?: { states?: unknown };
      acceptance?: unknown;
      risk?: { outOfScope?: unknown };
    };
    return {
      artifactVersion: artifact.version,
      rawContent: formatArtifactContent(artifact.content),
      summary: typeof parsed.summary === 'string' ? parsed.summary : '未填写摘要',
      userVisibleScope: stringArray(parsed.userVisibleScope),
      statusStates: stringArray(parsed.status?.states),
      acceptance: Array.isArray(parsed.acceptance)
        ? parsed.acceptance
          .map((item) => normalizeAcceptanceItem(item))
          .filter((item): item is { id: string; label: string; howToVerify: string } => item !== null)
        : [],
      outOfScope: stringArray(parsed.risk?.outOfScope),
    };
  } catch (error) {
    return {
      artifactVersion: artifact.version,
      rawContent: artifact.content,
      summary: '',
      userVisibleScope: [],
      statusStates: [],
      acceptance: [],
      outOfScope: [],
      parseError: `native-app-spec.json 解析失败：${(error as Error).message}`,
    };
  }
}

function isNativeSpecAcceptedForCurrentArtifact(
  spec: NativeSpecView | null,
  review: NativeSpecReview,
): boolean {
  return !!spec
    && !spec.parseError
    && isNativeSpecReviewAcceptedForArtifact(review, spec.artifactVersion);
}

function buildNativeSpecDraft(): string {
  return stringifyJson({
    version: 1,
    summary: '这个应用用于完成一个可配置、可运行、可验收的用户任务。',
    userVisibleScope: [
      '用户可以打开应用首页并看到当前配置状态。',
      '用户可以在设置里填写账号、通知和 AI 规则。',
      '用户可以手动运行一次任务并查看结果。',
    ],
    status: {
      states: ['not_configured', 'ready', 'running', 'success', 'failed', 'not_connected'],
      readyCriteria: ['必要设置已填写，底层能力可用。'],
      notConnectedBehavior: '缺少底层能力或账号未连接时，界面明确显示未接入 / 需官方能力，不伪装成功。',
    },
    settings: [
      {
        id: 'general',
        label: '基础设置',
        fields: ['账号选择', '通知方式', 'AI 提示词'],
      },
    ],
    data: {
      entities: [
        'app_settings',
        'app_automations',
        'run_history',
        'assistant_messages',
        'app_notifications',
        'app_command_runs',
        'acceptance_checks',
      ],
      reusableStores: ['settings', 'run_history'],
    },
    ai: {
      enabled: true,
      promptSettings: true,
      draftBeforeWrite: true,
      visibleFailureHandling: true,
    },
    automations: {
      enabled: true,
      controls: ['run_now', 'edit', 'delete'],
      visibleRunResults: true,
    },
    runResults: {
      visible: true,
      states: ['running', 'success', 'failed', 'cancelled'],
      failureReasons: true,
      retry: true,
    },
    im: {
      enabled: false,
      lowRiskCommands: [],
      confirmationRequiredFor: ['send_message', 'write_data'],
      visibleCommandResults: true,
    },
    risk: {
      writeActionsRequireConfirmation: true,
      highRiskActions: ['删除数据', '批量修改', '自动发送外部消息'],
      outOfScope: ['无确认自动写操作', '绕过官方账号授权'],
    },
    acceptance: [
      {
        id: 'open-app',
        label: '打开应用',
        howToVerify: '从应用列表进入应用，首页能展示状态和主要入口。',
      },
      {
        id: 'configure',
        label: '配置设置',
        howToVerify: '进入设置页，填写必要配置后能看到已就绪状态。',
      },
      {
        id: 'run-task',
        label: '手动运行',
        howToVerify: '点击运行按钮，界面展示运行中和最终结果。',
      },
      {
        id: 'failure-state',
        label: '失败可见',
        howToVerify: '缺账号或底层能力时，界面展示明确失败原因。',
      },
      {
        id: 'retry',
        label: '重试结果',
        howToVerify: '失败或取消后可以重新运行，并生成新的运行记录。',
      },
    ],
  });
}

function normalizeAcceptanceItem(
  item: unknown,
): { id: string; label: string; howToVerify: string } | null {
  if (!item || typeof item !== 'object') return null;
  const candidate = item as {
    id?: unknown;
    label?: unknown;
    howToVerify?: unknown;
  };
  if (
    typeof candidate.id !== 'string'
    || typeof candidate.label !== 'string'
    || typeof candidate.howToVerify !== 'string'
  ) {
    return null;
  }
  return {
    id: candidate.id,
    label: candidate.label,
    howToVerify: candidate.howToVerify,
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function formatArtifactContent(content: string): string {
  try {
    return stringifyJson(JSON.parse(content));
  } catch {
    return content;
  }
}

function formatNativeSpecIssues(
  issues: ReturnType<typeof validateNativeGradeAppSpec>,
): string {
  const details = issues
    .slice(0, 5)
    .map((issue) => `${issue.jsonPath}: ${issue.message}`)
    .join('；');
  const suffix = issues.length > 5 ? `；另有 ${issues.length - 5} 项` : '';
  return `规格未通过校验：${details}${suffix}`;
}

function formatInstallError(json: InstallResponse): string {
  const base = json.message ?? json.error ?? '安装失败';
  if (Array.isArray(json.issues) && json.issues.length > 0) {
    return `${base}：${JSON.stringify(json.issues.slice(0, 3), null, 2)}`;
  }
  return base;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

function findPreviousVersion(
  current: BuilderArtifact,
  versions: BuilderArtifact[],
): BuilderArtifact | undefined {
  return versions
    .filter((artifact) => artifact.filePath === current.filePath)
    .filter((artifact) => artifact.version < current.version)
    .filter((artifact) => artifact.status !== 'rolled_back')
    .sort((left, right) => right.version - left.version)[0];
}

function extractNonGoals(summary: Record<string, unknown> | undefined): string[] {
  const raw = summary?.nonGoals;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}
