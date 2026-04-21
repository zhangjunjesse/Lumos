/**
 * 工作流调试模式前端状态 —— 开关、当前 snapshot、正在跑的 step、详情面板。
 *
 * 一个工作流对应一份 debug session;snapshot 里包含所有已缓存 step 的元数据。
 * 真实 output payload 懒加载到 detailOutput(查看节点输出时才拉)。
 */
import create, { type SetState } from 'zustand';
import type {
  DebugRunRequest,
  DebugSessionSnapshot,
  DebugStepOutput,
} from '@/lib/workflow/debug-types';

type RunMode = DebugRunRequest['mode'];

interface RunResult {
  runId: string;
  sessionId: string;
  workflowRunId: string;
  debugSnapshot: DebugSessionSnapshot;
}

interface TraceState {
  loading: boolean;
  content: string | null;
  hasTrace: boolean;
  error: string | null;
}

interface WorkflowDebugState {
  enabled: boolean;
  workflowId: string | null;
  snapshot: DebugSessionSnapshot | null;
  loading: boolean;
  error: string | null;
  running: boolean;
  runningStepId: string | null;
  detailStepId: string | null;
  detailOutput: DebugStepOutput | null;
  detailLoading: boolean;
  /** stepId → 该 step 最近一次 debug run 的 trace(lazy load)。 */
  traceByStep: Record<string, TraceState>;

  setEnabled: (v: boolean) => void;
  setWorkflowId: (id: string | null) => void;
  refreshSnapshot: () => Promise<void>;
  runDebug: (mode: RunMode, targetStepId: string) => Promise<void>;
  clearAllCache: () => Promise<void>;
  deleteStepCache: (stepId: string, cascade: boolean) => Promise<void>;
  openStepDetail: (stepId: string) => Promise<void>;
  closeStepDetail: () => void;
  /** 懒加载某 step 的完整 trace,命中缓存不会重发请求。 */
  loadStepTrace: (stepId: string) => Promise<void>;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (res.ok) return res.json() as Promise<T>;
  const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
  throw new Error(body.error || res.statusText || '请求失败');
}

/**
 * Workflow `submitWorkflow` returns accepted while the run keeps executing in
 * the background. The initial snapshot is therefore a pre-run shot — stepping
 * cache rows land later as stages finish. We poll the session endpoint until
 * `session.status` leaves `running`, so the UI (node overlays + right-click
 * "查看缓存输出") stays in sync with actual DB state instead of showing a
 * stale snapshot frozen at submit time.
 */
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_DURATION_MS = 10 * 60 * 1000;

let activePollTimer: ReturnType<typeof setInterval> | null = null;
let activePollDeadline: ReturnType<typeof setTimeout> | null = null;
let activePollWorkflowId: string | null = null;

function stopSnapshotPolling(): void {
  if (activePollTimer) { clearInterval(activePollTimer); activePollTimer = null; }
  if (activePollDeadline) { clearTimeout(activePollDeadline); activePollDeadline = null; }
  activePollWorkflowId = null;
}

function startSnapshotPolling(
  workflowId: string,
  set: SetState<WorkflowDebugState>,
  isStillCurrent: () => boolean,
): void {
  stopSnapshotPolling();
  activePollWorkflowId = workflowId;

  const tick = async () => {
    if (!isStillCurrent() || activePollWorkflowId !== workflowId) {
      stopSnapshotPolling();
      return;
    }
    try {
      const res = await fetch(`/api/workflows/${workflowId}/debug/session`, { cache: 'no-store' });
      if (!res.ok) return;
      const snapshot = await res.json() as DebugSessionSnapshot;
      if (!isStillCurrent() || activePollWorkflowId !== workflowId) return;
      set({ snapshot });
      if (snapshot.session && snapshot.session.status !== 'running') {
        stopSnapshotPolling();
        set({ running: false, runningStepId: null });
      }
    } catch {
      // transient network errors — next tick retries
    }
  };

  activePollTimer = setInterval(tick, POLL_INTERVAL_MS);
  activePollDeadline = setTimeout(() => {
    stopSnapshotPolling();
    set({ running: false, runningStepId: null });
  }, POLL_MAX_DURATION_MS);
}

export const useWorkflowDebugStore = create<WorkflowDebugState>((set, get) => ({
  enabled: false,
  workflowId: null,
  snapshot: null,
  loading: false,
  error: null,
  running: false,
  runningStepId: null,
  detailStepId: null,
  detailOutput: null,
  detailLoading: false,
  traceByStep: {},

  setEnabled: (v) => {
    set({ enabled: v });
    if (!v) {
      stopSnapshotPolling();
      set({ running: false, runningStepId: null });
      return;
    }
    if (get().workflowId) void get().refreshSnapshot();
  },

  setWorkflowId: (id) => {
    const prev = get().workflowId;
    if (prev === id) return;
    stopSnapshotPolling();
    set({
      workflowId: id,
      snapshot: null,
      detailStepId: null,
      detailOutput: null,
      error: null,
      running: false,
      runningStepId: null,
      traceByStep: {},
    });
    if (id && get().enabled) void get().refreshSnapshot();
  },

  refreshSnapshot: async () => {
    const id = get().workflowId;
    if (!id) return;
    set({ loading: true, error: null });
    try {
      const snapshot = await jsonOrThrow<DebugSessionSnapshot>(
        await fetch(`/api/workflows/${id}/debug/session`),
      );
      set({ snapshot, loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  runDebug: async (mode, targetStepId) => {
    const id = get().workflowId;
    if (!id) return;
    stopSnapshotPolling();
    // 新 run 后旧 trace 就失效了,全量清掉让下次展开时重新按新 runId 拉
    set({ running: true, runningStepId: targetStepId, error: null, traceByStep: {} });
    try {
      const result = await jsonOrThrow<RunResult>(
        await fetch(`/api/workflows/${id}/debug/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflowId: id, mode, targetStepId } satisfies DebugRunRequest),
        }),
      );
      set({ snapshot: result.debugSnapshot });
      startSnapshotPolling(id, set, () => get().workflowId === id && get().enabled);
    } catch (e) {
      stopSnapshotPolling();
      set({ error: (e as Error).message, running: false, runningStepId: null });
    }
  },

  clearAllCache: async () => {
    const id = get().workflowId;
    if (!id) return;
    await jsonOrThrow<{ success: true }>(
      await fetch(`/api/workflows/${id}/debug/session`, { method: 'DELETE' }),
    );
    set({ detailStepId: null, detailOutput: null });
    await get().refreshSnapshot();
  },

  deleteStepCache: async (stepId, cascade) => {
    const id = get().workflowId;
    if (!id) return;
    const qs = cascade ? '?cascade=true' : '';
    await jsonOrThrow<{ success: true }>(
      await fetch(`/api/workflows/${id}/debug/session/step/${stepId}${qs}`, { method: 'DELETE' }),
    );
    if (get().detailStepId === stepId) set({ detailStepId: null, detailOutput: null });
    await get().refreshSnapshot();
  },

  openStepDetail: async (stepId) => {
    const id = get().workflowId;
    if (!id) return;
    set({ detailStepId: stepId, detailOutput: null, detailLoading: true, error: null });
    try {
      const output = await jsonOrThrow<DebugStepOutput>(
        await fetch(`/api/workflows/${id}/debug/session/step/${stepId}`),
      );
      set({ detailOutput: output, detailLoading: false });
    } catch (e) {
      set({ error: (e as Error).message, detailLoading: false });
    }
  },

  closeStepDetail: () => set({ detailStepId: null, detailOutput: null }),

  loadStepTrace: async (stepId) => {
    const { workflowId, snapshot, traceByStep } = get();
    if (!workflowId) return;
    const runId = snapshot?.latestRunId;
    if (!runId) {
      set({ traceByStep: { ...traceByStep, [stepId]: { loading: false, content: null, hasTrace: false, error: '当前没有可用的 run 记录' } } });
      return;
    }
    // 缓存策略:正在拉的跳过,已拉过且成功的跳过,失败的允许重试
    const cached = traceByStep[stepId];
    if (cached && (cached.loading || !cached.error)) return;
    set({ traceByStep: { ...traceByStep, [stepId]: { loading: true, content: null, hasTrace: false, error: null } } });
    try {
      const res = await fetch(`/api/workflows/${workflowId}/debug/runs/${runId}/steps/${stepId}/trace`, { cache: 'no-store' });
      const data = await res.json() as { trace?: string | null; hasTrace?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error || '加载完整对话失败');
      set((state) => ({
        traceByStep: {
          ...state.traceByStep,
          [stepId]: { loading: false, content: data.trace ?? null, hasTrace: !!data.hasTrace, error: null },
        },
      }));
    } catch (e) {
      set((state) => ({
        traceByStep: {
          ...state.traceByStep,
          [stepId]: { loading: false, content: null, hasTrace: false, error: (e as Error).message },
        },
      }));
    }
  },
}));
