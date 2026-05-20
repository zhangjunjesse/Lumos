"use client";

import { useCallback, useEffect, useState } from "react";
import { Coins, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseDBDate } from "@/lib/utils";

interface SummaryRow {
  module: string;
  operation: string;
  status: string;
  count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  last_at: string;
}
interface LogRow {
  id: string;
  module: string;
  operation: string;
  model: string;
  status: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  created_at: string;
}
interface UsageData {
  total: { input: number; output: number; total: number; calls: number };
  summary: SummaryRow[];
  rows: LogRow[];
}

const WINDOWS: { label: string; h: number }[] = [
  { label: "近 24 小时", h: 24 },
  { label: "近 7 天", h: 168 },
  { label: "近 30 天", h: 720 },
];

function fmt(n: number): string {
  return (n || 0).toLocaleString("en-US");
}

// 库里是 UTC，按本地时区显示（与每日复盘口径一致）。
function fmtTime(s: string): string {
  const d = parseDBDate(s);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function TokenUsageCard() {
  const [data, setData] = useState<UsageData | null>(null);
  const [windowH, setWindowH] = useState(24);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/llm-usage?windowHours=${windowH}`, { cache: "no-store" });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d) throw new Error(d?.error || `加载失败（HTTP ${res.status}）`);
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [windowH]);

  useEffect(() => {
    void load();
  }, [load]);

  const t = data?.total;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Coins className="h-4 w-4 text-muted-foreground" />
            Token 消耗记录
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            所有 LLM 调用的真实 token 用量（含每日复盘自动化）。仅统计结构化/文本生成调用。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border p-0.5">
            {WINDOWS.map((w) => (
              <button
                key={w.h}
                type="button"
                onClick={() => setWindowH(w.h)}
                className={
                  "rounded px-2 py-1 text-xs " +
                  (windowH === w.h ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")
                }
              >
                {w.label}
              </button>
            ))}
          </div>
          <Button type="button" size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            刷新
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
      )}

      {loading ? (
        <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在加载...
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="调用次数" value={fmt(t?.calls ?? 0)} />
            <Metric label="合计 tokens" value={fmt(t?.total ?? 0)} />
            <Metric label="输入 tokens" value={fmt(t?.input ?? 0)} />
            <Metric label="输出 tokens" value={fmt(t?.output ?? 0)} />
          </div>

          {(data?.rows.length ?? 0) === 0 ? (
            <div className="mt-4 rounded-md border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
              这个时间段没有 LLM 调用记录。
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-muted/40 text-left font-medium text-muted-foreground">
                    <th className="border-b border-r border-border px-3 py-2">时间</th>
                    <th className="border-b border-r border-border px-3 py-2">模块·操作</th>
                    <th className="border-b border-r border-border px-3 py-2">模型</th>
                    <th className="border-b border-r border-border px-3 py-2 text-right">输入</th>
                    <th className="border-b border-r border-border px-3 py-2 text-right">输出</th>
                    <th className="border-b border-r border-border px-3 py-2 text-right">合计</th>
                    <th className="border-b border-border px-3 py-2">状态</th>
                  </tr>
                </thead>
                <tbody className="align-top">
                  {data!.rows.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-b-0">
                      <td className="whitespace-nowrap border-r border-border px-3 py-2 text-muted-foreground">
                        {fmtTime(r.created_at)}
                      </td>
                      <td className="border-r border-border px-3 py-2">
                        {r.module || "—"}
                        <span className="text-muted-foreground"> · {r.operation || "—"}</span>
                      </td>
                      <td className="break-all border-r border-border px-3 py-2">{r.model || "—"}</td>
                      <td className="border-r border-border px-3 py-2 text-right">{fmt(r.input_tokens)}</td>
                      <td className="border-r border-border px-3 py-2 text-right">{fmt(r.output_tokens)}</td>
                      <td className="border-r border-border px-3 py-2 text-right font-medium">{fmt(r.total_tokens)}</td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            r.status === "succeeded"
                              ? "text-emerald-700"
                              : r.status === "started"
                                ? "text-muted-foreground"
                                : "text-rose-700"
                          }
                        >
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
