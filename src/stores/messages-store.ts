import create from 'zustand';
import { persist } from 'zustand/middleware';
import type { Message } from '@/types';

export interface SessionMessages {
  sessionId: string;
  messages: Message[];
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  lastFetch: number; // timestamp
}

export interface MessagesStore {
  sessions: Record<string, SessionMessages>;

  // Get messages for a session
  getSession: (sessionId: string) => SessionMessages | null;

  // Update session messages
  updateSession: (sessionId: string, updates: Partial<Omit<SessionMessages, 'sessionId' | 'lastFetch'>>) => void;

  // Add a new message to session
  addMessage: (sessionId: string, message: Message) => void;

  // Update a specific message
  updateMessage: (sessionId: string, messageId: number, updates: Partial<Message>) => void;

  // Clear session messages (for refresh)
  clearSession: (sessionId: string) => void;

  // Remove old sessions from cache (older than 24h)
  cleanup: () => void;
}

export const useMessagesStore = create<MessagesStore>(
  persist(
    (set, get) => ({
      sessions: {},

      getSession: (sessionId: string) => {
        return get().sessions[sessionId] || null;
      },

      updateSession: (sessionId: string, updates: Partial<Omit<SessionMessages, 'sessionId' | 'lastFetch'>>) => {
        set((state) => {
          const existing = state.sessions[sessionId];
          const now = Date.now();

          if (existing) {
            // Update existing session
            return {
              sessions: {
                ...state.sessions,
                [sessionId]: {
                  ...existing,
                  ...updates,
                  lastFetch: now,
                },
              },
            };
          } else {
            // Create new session
            return {
              sessions: {
                ...state.sessions,
                [sessionId]: {
                  sessionId,
                  messages: [],
                  hasMore: false,
                  loading: false,
                  error: null,
                  lastFetch: now,
                  ...updates,
                },
              },
            };
          }
        });
      },

      addMessage: (sessionId: string, message: Message) => {
        set((state) => {
          const session = state.sessions[sessionId];
          if (!session) return state;

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...session,
                messages: [...session.messages, message],
                lastFetch: Date.now(),
              },
            },
          };
        });
      },

      updateMessage: (sessionId: string, messageId: number, updates: Partial<Message>) => {
        set((state) => {
          const session = state.sessions[sessionId];
          if (!session) return state;

          const messageIndex = session.messages.findIndex((m) => String(m.id) === String(messageId));
          if (messageIndex === -1) return state;

          const updatedMessages = [...session.messages];
          updatedMessages[messageIndex] = {
            ...updatedMessages[messageIndex],
            ...updates,
          };

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...session,
                messages: updatedMessages,
                lastFetch: Date.now(),
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

      cleanup: () => {
        set((state) => {
          const now = Date.now();
          const ONE_DAY = 24 * 60 * 60 * 1000;
          const sessions: Record<string, SessionMessages> = {};

          Object.entries(state.sessions).forEach(([id, session]) => {
            // Keep sessions fetched within last 24h
            if (now - session.lastFetch < ONE_DAY) {
              sessions[id] = session;
            }
          });

          return { sessions };
        });
      },
    }),
    {
      name: 'lumos-messages-store',
    }
  )
);

// Auto-cleanup on load
if (typeof window !== 'undefined') {
  useMessagesStore.getState().cleanup();
}
