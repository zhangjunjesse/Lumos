"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Loader2, Moon, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DailyReview, ReviewStatus } from "./types";
import { ReviewSessionItem } from "./ReviewSessionItem";

const STATUS_LABEL: Record<ReviewStatus, string> = {
  ok: "已生成",
  empty: "当天无会话",
  unavailable: "模型不可用",
  error: "失败",
};

function statusClass(status: ReviewStatus): string {
  if (status === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "empty") return "border-zinc-200 bg-zinc-50 text-zinc-600";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

export function DailyReviewList() {
  const [reviews, setReviews] = useState<DailyReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/memory-v2/daily-review?limit=60", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!data) throw new Error(`加载失败（HTTP ${res.status}）`);
      setReviews(data.reviews || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runNow() {
    setRunning(true);
    setError("");
    try {
      const res = await fetch("/api/memory-v2/daily-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!data) throw new Error(`生成失败（HTTP ${res.status}）`);
      setReviews(data.reviews || []);
      const run = data.run;
      if (run && run.status !== "ok") {
        setError(
          run.status === "empty"
            ? "当天没有会话。"
            : run.status === "unavailable"
              ? "文本模型不可用，总结未生成（会话仍可点开看原对话）。"
              : `总结生成失败：${run.error || "未知错误"}（会话仍可点开看原对话）。`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            每日复盘
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            当天的会话列表，点任意一条看它的对话详情和总结。原始会话不动。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            刷新
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={runNow} disabled={running}>
            {running ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Moon className="mr-1.5 h-3.5 w-3.5" />}
            生成今日
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
      )}

      {loading ? (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在加载...
        </div>
      ) : reviews.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-6 py-12 text-center text-xs text-muted-foreground">
          还没有记录。每日睡眠会自动生成，或点「生成今日」手动跑一次。
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {reviews.map((review) => (
            <ReviewDay key={review.id} review={review} />
          ))}
        </div>
      )}
    </section>
  );
}

function ReviewDay({ review }: { review: DailyReview }) {
  const notCounted = Math.max(0, review.sessionCount - review.sourceSessions.length);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{review.reviewDay}</span>
        <span className={cn("rounded-full border px-2 py-0.5 text-xs", statusClass(review.status))}>
          {STATUS_LABEL[review.status]}
        </span>
        <Badge variant="outline">{review.sessionCount} 个会话</Badge>
      </div>

      {review.sourceSessions.length === 0 ? (
        <div className="rounded border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          {review.status === "empty" ? "当天没有产生任何会话。" : "没有可显示的会话。"}
        </div>
      ) : (
        <div className="space-y-1.5">
          {review.sourceSessions.map((s) => (
            <ReviewSessionItem key={s.id} session={s} />
          ))}
        </div>
      )}

      {review.truncated && notCounted > 0 && (
        <p className="mt-1.5 text-xs text-amber-700">
          会话过多，仅列出前 {review.sourceSessions.length} 个，其余 {notCounted} 个未计入。
        </p>
      )}
    </div>
  );
}
