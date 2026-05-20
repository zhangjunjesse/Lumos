"use client";

import { Fragment, useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DigestPromptDialog } from "@/components/memory-v2/DigestPromptDialog";
import {
  DigestActionResult,
  toActionResult,
  type ActionResult,
  type DigestActionKind,
} from "@/components/memory-v2/DigestActionResult";
import type { SourceSession } from "@/components/memory-v2/types";

export interface SessionLinks {
  improvements: Record<string, Record<string, unknown>>;
  experiences: Record<string, Record<string, unknown>>;
  insightEntries: Record<string, Record<string, unknown>>;
}

function friendlyErr(code?: string): string {
  if (code === "event_not_found" || code === "insight_not_found") {
    return "数据可能已更新，请刷新页面后重试。";
  }
  return code || "未知错误";
}

export function SessionSummaryTab({
  sessionId,
  session,
  links,
  onReload,
}: {
  sessionId: string;
  session: SourceSession | null;
  links: SessionLinks | null;
  onReload: () => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const [actionBusy, setActionBusy] = useState("");
  const [actionMsg, setActionMsg] = useState("");
  const [results, setResults] = useState<Record<string, ActionResult>>({});

  const digest = session?.digest ?? null;
  const events = digest?.events ?? [];
  const insights = digest?.insights ?? [];

  // 进页面/重载后：按编号把已生成的进化建议与经验回显。
  useEffect(() => {
    if (!links) {
      setResults({});
      return;
    }
    const seeded: Record<string, ActionResult> = {};
    const add = (action: DigestActionKind, id: string, payload: { candidate?: Record<string, unknown>; entry?: Record<string, unknown> }) => {
      const r = toActionResult(action, payload);
      if (r) seeded[`${action}:${id}`] = r;
    };
    for (const [eid, c] of Object.entries(links.improvements || {})) add("improvement", eid, { candidate: c });
    for (const [eid, e] of Object.entries(links.experiences || {})) add("experience", eid, { entry: e });
    for (const [iid, e] of Object.entries(links.insightEntries || {})) add("insight", iid, { entry: e });
    setResults(seeded);
  }, [links]);

  async function understand() {
    setGenerating(true);
    setGenError("");
    try {
      const res = await fetch(`/api/memory-v2/daily-review/session/${sessionId}`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!data) throw new Error(`生成失败（HTTP ${res.status}）`);
      if (data.status !== "ok") {
        setGenError(
          data.status === "empty"
            ? "这个会话没有可总结的内容。"
            : data.status === "unavailable"
              ? "文本模型不可用，未生成（未编造）。"
              : `生成失败：${friendlyErr(data.error)}`,
        );
      }
      onReload(); // 重新拉 session + links，按新编号回显
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setGenerating(false);
    }
  }

  async function runAction(action: DigestActionKind, index: number, id: string) {
    setActionBusy(`${action}:${id}`);
    setActionMsg("");
    try {
      const res = await fetch(`/api/memory-v2/daily-review/session/${sessionId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, index }),
      });
      const data = await res.json().catch(() => null);
      if (!data) throw new Error(`操作失败（HTTP ${res.status}）`);
      if (data.status === "ok") {
        const r = toActionResult(action, data);
        if (r) setResults((prev) => ({ ...prev, [`${action}:${id}`]: r }));
        else setActionMsg("已完成。");
      } else {
        setActionMsg(
          data.status === "unavailable"
            ? "文本模型不可用，未生成（未编造）。"
            : `失败：${friendlyErr(data.error)}`,
        );
      }
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "操作失败");
    } finally {
      setActionBusy("");
    }
  }

  const busyKey = (k: string) => actionBusy === k;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {events.length > 0 ? `共 ${events.length} 个事件` : "会话总结"}
        </div>
        <div className="flex items-center gap-2">
          <DigestPromptDialog />
          <Button type="button" size="sm" variant="outline" onClick={understand} disabled={generating}>
            {generating ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            {digest ? "重新理解总结" : "理解总结"}
          </Button>
        </div>
      </div>

      {genError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{genError}</div>
      )}
      {actionMsg && (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">{actionMsg}</div>
      )}

      {events.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-10" />
              <col className="w-[22%]" />
              <col className="w-[24%]" />
              <col className="w-[16%]" />
              <col />
              <col className="w-36" />
            </colgroup>
            <thead>
              <tr className="bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                <th className="border-b border-r border-border px-3 py-2.5 text-center">#</th>
                <th className="border-b border-r border-border px-4 py-2.5">需求</th>
                <th className="border-b border-r border-border px-4 py-2.5">执行过程</th>
                <th className="border-b border-r border-border px-4 py-2.5">结果</th>
                <th className="border-b border-r border-border px-4 py-2.5">不足</th>
                <th className="border-b border-border px-3 py-2.5">操作</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {events.map((ev, i) => {
                const imp = results[`improvement:${ev.id}`];
                const exp = results[`experience:${ev.id}`];
                return (
                  <Fragment key={ev.id}>
                    <tr className={i < events.length - 1 ? "border-b border-border" : ""}>
                      <td className="border-r border-border px-3 py-4 text-center text-xs text-muted-foreground">
                        {i + 1}
                      </td>
                      <td className="break-words border-r border-border px-4 py-4 leading-7 text-foreground">
                        {ev.requirement || "—"}
                        <div className="mt-1 font-mono text-[11px] text-muted-foreground">编号 {ev.id}</div>
                      </td>
                      <td className="break-words border-r border-border px-4 py-4 leading-7 text-muted-foreground">
                        {ev.process || "—"}
                      </td>
                      <td className="break-words border-r border-border px-4 py-4 leading-7 text-foreground">
                        {ev.outcome || "—"}
                      </td>
                      <td className="border-r border-border px-4 py-4 leading-7">
                        {ev.shortcomings.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <ul className="space-y-2">
                            {ev.shortcomings.map((sc, j) => (
                              <li key={j} className="flex gap-2 break-words text-foreground">
                                <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-rose-500" />
                                <span>{sc}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-3 py-4">
                        <div className="flex flex-col gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            disabled={actionBusy !== ""}
                            onClick={() => runAction("improvement", i, ev.id)}
                          >
                            {busyKey(`improvement:${ev.id}`) && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                            {imp ? "重新生成" : "进化建议"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            disabled={actionBusy !== ""}
                            onClick={() => runAction("experience", i, ev.id)}
                          >
                            {busyKey(`experience:${ev.id}`) && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                            {exp ? "重新沉淀" : "沉淀经验"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {(imp || exp) && (
                      <tr className={i < events.length - 1 ? "border-b border-border" : ""}>
                        <td colSpan={6} className="bg-muted/10 px-4 py-3">
                          <div className="space-y-2">
                            {imp && <DigestActionResult result={imp} />}
                            {exp && <DigestActionResult result={exp} />}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-xs leading-5 text-muted-foreground">
          {digest
            ? "本次没有可总结的事件。"
            : "该会话未生成总结。点上方「理解总结」让 AI 现在读这个会话并生成（失败不编造）。"}
        </div>
      )}

      {insights.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">经验与偏好</h3>
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {insights.map((it, i) => {
              const r = results[`insight:${it.id}`];
              return (
                <Fragment key={it.id}>
                  <div className="flex items-start gap-3 px-4 py-3">
                    <span
                      className={
                        "mt-0.5 shrink-0 whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-medium " +
                        (it.type === "用户偏好"
                          ? "border-sky-200 bg-sky-50 text-sky-700"
                          : it.type === "经验"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-amber-200 bg-amber-50 text-amber-700")
                      }
                    >
                      {it.type}
                    </span>
                    <span className="flex-1 break-words text-sm leading-6 text-foreground">{it.content}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 px-2 text-xs"
                      disabled={actionBusy !== ""}
                      onClick={() => runAction("insight", i, it.id)}
                    >
                      {busyKey(`insight:${it.id}`) && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                      {r ? "重新沉淀" : "沉淀"}
                    </Button>
                  </div>
                  {r && (
                    <div className="px-4 py-3">
                      <DigestActionResult result={r} />
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
