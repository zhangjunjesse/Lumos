import create from 'zustand';
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
}

// In-memory only. Messages are the server's responsibility (SQLite) and are
// re-fetched from /api/chat/sessions/:id/messages on mount, so this store must
// NOT be persisted to localStorage: doing so blew past the ~5MB quota on write
// and OOM-crashed the renderer when reloading megabytes of history. See #25/#26.
export const useMessagesStore = create<MessagesStore>((set, get) => ({
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
}));
