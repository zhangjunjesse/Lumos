"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SessionMessages } from "@/components/memory-v2/SessionMessages";
import { SessionSummaryTab, type SessionLinks } from "@/components/memory-v2/SessionSummaryTab";
import type { SourceSession } from "@/components/memory-v2/types";

export default function ReviewSessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<SourceSession | null>(null);
  const [reviewDay, setReviewDay] = useState("");
  const [links, setLinks] = useState<SessionLinks | null>(null);
  const [conversationAvailable, setConversationAvailable] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/memory-v2/daily-review/session/${id}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      setSession(data?.session ?? null);
      setReviewDay(data?.reviewDay || "");
      setLinks(data?.links ?? null);
      setConversationAvailable(data?.conversationAvailable !== false);
    } catch {
      setSession(null);
      setLinks(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const titlePreview = (session?.title || "").trim();

  return (
    <main className="flex h-full min-h-0 flex-col bg-background">
      <header className="shrink-0 border-b border-border px-6 py-4">
        <Link
          href="/memory-v2"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          返回每日复盘
        </Link>
        <div className="mt-3">
          <h1 className="text-lg font-semibold tracking-tight">会话详情</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {reviewDay && <span>{reviewDay}</span>}
            {reviewDay && <span className="text-border">·</span>}
            <span className="font-mono">{id.slice(0, 12)}</span>
          </div>
          {titlePreview && (
            <p className="mt-1.5 line-clamp-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">会话名称：</span>
              {titlePreview}
            </p>
          )}
          {!loading && !conversationAvailable && (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs leading-5 text-amber-800">
              原会话已删除——分析、进化建议与沉淀经验仍完整保留；仅「对话详情」无法回看。
            </p>
          )}
        </div>
      </header>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在加载...
        </div>
      ) : (
        <Tabs defaultValue="summary" className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="shrink-0 border-b border-border px-6 pt-3">
            <TabsList>
              <TabsTrigger value="summary">会话总结</TabsTrigger>
              <TabsTrigger value="conversation">对话详情</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="summary" className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <SessionSummaryTab sessionId={id} session={session} links={links} onReload={load} />
          </TabsContent>

          <TabsContent value="conversation" className="flex min-h-0 flex-1 flex-col">
            <SessionMessages sessionId={id} />
          </TabsContent>
        </Tabs>
      )}
    </main>
  );
}
