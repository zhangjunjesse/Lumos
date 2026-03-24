"use client";

import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading } from "@hugeicons/core-free-icons";
import { ChatView } from "@/components/chat/ChatView";
import type { ChatSession, Message, MessagesResponse } from "@/types";
import {
  isIsolatedLibraryChatSession,
} from "@/lib/chat/library-session";

const STORAGE_KEY = "lumos:library-chat-session";

type LibraryChatPanelProps = {
  compactInputOnly?: boolean;
  onInputFocus?: () => void;
  fullWidth?: boolean;
  hideEmptyState?: boolean;
};

export function LibraryChatPanel({
  compactInputOnly = false,
  onInputFocus,
  fullWidth = false,
  hideEmptyState = false,
}: LibraryChatPanelProps) {
  const [sessionId, setSessionId] = useState("");
  const [sessionModel, setSessionModel] = useState("");
  const [sessionProviderId, setSessionProviderId] = useState("");
  const [sessionWorkingDirectory, setSessionWorkingDirectory] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadMessages = useCallback(async (id: string) => {
    const res = await fetch(`/api/chat/sessions/${id}/messages?limit=100`);
    if (!res.ok) return;
    const data: MessagesResponse = await res.json();
    setMessages(data.messages || []);
    setHasMore(data.hasMore ?? false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setLoading(true);
      setError("");

      let nextSession: ChatSession | null = null;
      const cachedId = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;

      if (cachedId) {
        try {
          const res = await fetch(`/api/chat/sessions/${cachedId}`);
          if (res.ok) {
            const data: { session: ChatSession } = await res.json();
            if (isIsolatedLibraryChatSession(data.session)) {
              nextSession = data.session;
            } else if (typeof window !== "undefined") {
              localStorage.removeItem(STORAGE_KEY);
            }
          } else if (typeof window !== "undefined") {
            localStorage.removeItem(STORAGE_KEY);
          }
        } catch {
          if (typeof window !== "undefined") {
            localStorage.removeItem(STORAGE_KEY);
          }
        }
      }

      if (!nextSession) {
        try {
          const res = await fetch("/api/library/chat/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || "初始化资料库会话失败");
          }
          const data: { session: ChatSession } = await res.json();
          nextSession = data.session;
          if (typeof window !== "undefined") {
            localStorage.setItem(STORAGE_KEY, data.session.id);
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "初始化资料库会话失败");
            setLoading(false);
          }
          return;
        }
      }

      if (!nextSession || cancelled) return;

      setSessionId(nextSession.id);
      setSessionModel(nextSession.model || "");
      setSessionProviderId(nextSession.provider_id || "");
      setSessionWorkingDirectory(nextSession.working_directory || "");
      await loadMessages(nextSession.id);

      if (!cancelled) {
        setLoading(false);
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, [loadMessages]);

  useEffect(() => {
    if (!sessionId) return;
    const interval = window.setInterval(() => {
      void loadMessages(sessionId);
    }, 4000);
    return () => {
      window.clearInterval(interval);
    };
  }, [loadMessages, sessionId]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <HugeiconsIcon icon={Loading} className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!sessionId) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden bg-background">
        <ChatView
          key={sessionId}
          sessionId={sessionId}
          initialMessages={messages}
          initialHasMore={hasMore}
          modelName={sessionModel}
          initialKnowledgeEnabled
          providerId={sessionProviderId}
          workingDirectoryOverride={sessionWorkingDirectory}
          compactInputOnly={compactInputOnly}
          onInputFocus={onInputFocus}
          fullWidth={fullWidth}
          hideEmptyState={hideEmptyState}
        />
      </div>
    </div>
  );
}
