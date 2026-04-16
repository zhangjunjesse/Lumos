/**
 * 工作流调试模式前端状态 —— 开关、当前 snapshot、正在跑的 step、详情面板。
 *
 * 一个工作流对应一份 debug session;snapshot 里包含所有已缓存 step 的元数据。
 * 真实 output payload 懒加载到 detailOutput(查看节点输出时才拉)。
 */
import create from 'zustand';
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

  setEnabled: (v: boolean) => void;
  setWorkflowId: (id: string | null) => void;
  refreshSnapshot: () => Promise<void>;
  runDebug: (mode: RunMode, targetStepId: string) => Promise<void>;
  clearAllCache: () => Promise<void>;
  deleteStepCache: (stepId: string, cascade: boolean) => Promise<void>;
  openStepDetail: (stepId: string) => Promise<void>;
  closeStepDetail: () => void;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (res.ok) return res.json() as Promise<T>;
  const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
  throw new Error(body.error || res.statusText || '请求失败');
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

  setEnabled: (v) => {
    set({ enabled: v });
    if (v && get().workflowId) void get().refreshSnapshot();
  },

  setWorkflowId: (id) => {
    const prev = get().workflowId;
    if (prev === id) return;
    set({
      workflowId: id,
      snapshot: null,
      detailStepId: null,
      detailOutput: null,
      error: null,
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
    set({ running: true, runningStepId: targetStepId, error: null });
    try {
      const result = await jsonOrThrow<RunResult>(
        await fetch(`/api/workflows/${id}/debug/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflowId: id, mode, targetStepId } satisfies DebugRunRequest),
        }),
      );
      set({ snapshot: result.debugSnapshot, running: false, runningStepId: null });
    } catch (e) {
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
}));
