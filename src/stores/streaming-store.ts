import create from 'zustand';
import { persist } from 'zustand/middleware';

export interface ToolUseInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultInfo {
  tool_use_id: string;
  content?: string;
  is_error?: boolean;
}

export interface StreamingState {
  sessionId: string;
  status: 'idle' | 'streaming' | 'completed' | 'error';
  content: string;
  toolUses: ToolUseInfo[];
  toolResults: ToolResultInfo[];
  streamingToolOutput: string;
  statusText: string;
  updatedAt: number;
  startedAt: number;
}

interface StreamingStore {
  sessions: Record<string, StreamingState>;

  // Get session streaming state
  getSession: (sessionId: string) => StreamingState | null;

  // Update session state
  updateSession: (sessionId: string, updates: Partial<Omit<StreamingState, 'sessionId' | 'updatedAt'>>) => void;

  // Start streaming
  startStreaming: (sessionId: string) => void;

  // Complete streaming
  completeStreaming: (sessionId: string) => void;

  // Error streaming
  errorStreaming: (sessionId: string) => void;

  // Clear session state
  clearSession: (sessionId: string) => void;

  // Clear old completed sessions (keep only last 24h)
  cleanupOldSessions: () => void;
}

export const useStreamingStore = create<StreamingStore>(
  persist(
    (set, get) => ({
      sessions: {},

      getSession: (sessionId: string) => {
        return get().sessions[sessionId] || null;
      },

      updateSession: (sessionId: string, updates: Partial<Omit<StreamingState, 'sessionId' | 'updatedAt'>>) => {
        set((state) => {
          const existing = state.sessions[sessionId];
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                sessionId,
                status: 'streaming',
                content: '',
                toolUses: [],
                toolResults: [],
                streamingToolOutput: '',
                statusText: '',
                startedAt: Date.now(),
                ...existing,
                ...updates,
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      startStreaming: (sessionId: string) => {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [sessionId]: {
              sessionId,
              status: 'streaming',
              content: '',
              toolUses: [],
              toolResults: [],
              streamingToolOutput: '',
              statusText: '',
              startedAt: Date.now(),
              updatedAt: Date.now(),
            },
          },
        }));
      },

      completeStreaming: (sessionId: string) => {
        set((state) => {
          const existing = state.sessions[sessionId];
          if (!existing) return state;

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                status: 'completed',
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      errorStreaming: (sessionId: string) => {
        set((state) => {
          const existing = state.sessions[sessionId];
          if (!existing) return state;

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                status: 'error',
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      clearSession: (sessionId: string) => {
        set((state) => {
          const { [sessionId]: _, ...rest } = state.sessions;
          return { sessions: rest };
        });
      },

      cleanupOldSessions: () => {
        const now = Date.now();
        const ONE_DAY = 24 * 60 * 60 * 1000;

        set((state) => {
          const sessions = { ...state.sessions };

          Object.keys(sessions).forEach((sessionId) => {
            const session = sessions[sessionId];
            // Keep streaming sessions, remove completed sessions older than 24h
            if (
              session.status === 'completed' &&
              now - session.updatedAt > ONE_DAY
            ) {
              delete sessions[sessionId];
            }
          });

          return { sessions };
        });
      },
    }),
    {
      name: 'lumos-streaming-store',
    }
  )
);

// Auto cleanup on mount
if (typeof window !== 'undefined') {
  useStreamingStore.getState().cleanupOldSessions();
}
