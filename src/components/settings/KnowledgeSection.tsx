"use client";

import { useCallback, useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";

type RetrievalMode = "reference" | "enhanced";

export function KnowledgeSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<RetrievalMode>("reference");
  const [rewriteEnabled, setRewriteEnabled] = useState(true);
  const [topK, setTopK] = useState(4);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/app");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "读取知识库设置失败");
      }
      const settings = data?.settings || {};
      setEnabled(settings.kb_context_enabled !== "false");
      setMode((settings.kb_retrieval_mode || "").toLowerCase() === "enhanced" ? "enhanced" : "reference");
      setRewriteEnabled(settings.kb_query_rewrite_enabled !== "false");
      const parsedTopK = Number(settings.kb_context_top_k || "4");
      if (Number.isFinite(parsedTopK) && parsedTopK > 0) {
        setTopK(Math.max(2, Math.min(10, Math.floor(parsedTopK))));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const saveSettings = useCallback(async (next: {
    enabled?: boolean;
    mode?: RetrievalMode;
    rewriteEnabled?: boolean;
    topK?: number;
  }) => {
    const nextEnabled = next.enabled ?? enabled;
    const nextMode = next.mode ?? mode;
    const nextRewriteEnabled = next.rewriteEnabled ?? rewriteEnabled;
    const nextTopK = next.topK ?? topK;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            kb_context_enabled: nextEnabled ? "true" : "false",
            kb_retrieval_mode: nextMode,
            kb_context_top_k: String(nextTopK),
            kb_query_rewrite_enabled: nextRewriteEnabled ? "true" : "false",
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "保存失败");
      }
      setEnabled(nextEnabled);
      setMode(nextMode);
      setRewriteEnabled(nextRewriteEnabled);
      setTopK(nextTopK);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [enabled, mode, rewriteEnabled, topK]);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="rounded-2xl border p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">知识库检索设置</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              统一配置知识检索行为。资料库页面不再展示这些策略参数。
            </p>
          </div>
          <a
            href="/knowledge"
            className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
          >
            查看知识库页面
          </a>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
        ) : null}

        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">启用知识库检索</div>
              <p className="text-xs text-muted-foreground">关闭后，对话不再注入知识库上下文。</p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => void saveSettings({ enabled: checked })}
              disabled={loading || saving}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void saveSettings({ mode: "reference" })}
              disabled={loading || saving || !enabled}
              className={`rounded-xl border p-3 text-left transition-colors disabled:opacity-50 ${
                mode === "reference"
                  ? "border-primary/40 bg-primary/5"
                  : "border-border bg-background hover:bg-accent"
              }`}
            >
              <div className="text-sm font-medium">路径深读模式</div>
              <div className="mt-1 text-xs text-muted-foreground">优先给模型路径，按需读取原文再作答。</div>
            </button>
            <button
              type="button"
              onClick={() => void saveSettings({ mode: "enhanced" })}
              disabled={loading || saving || !enabled}
              className={`rounded-xl border p-3 text-left transition-colors disabled:opacity-50 ${
                mode === "enhanced"
                  ? "border-primary/40 bg-primary/5"
                  : "border-border bg-background hover:bg-accent"
              }`}
            >
              <div className="text-sm font-medium">增强检索模式</div>
              <div className="mt-1 text-xs text-muted-foreground">注入更多语义片段，适合快速问答场景。</div>
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">语义扩展</div>
              <p className="text-xs text-muted-foreground">自动生成 2-3 个同义表达提升检索命中。</p>
            </div>
            <Switch
              checked={rewriteEnabled}
              onCheckedChange={(checked) => void saveSettings({ rewriteEnabled: checked })}
              disabled={loading || saving || !enabled}
            />
          </div>

          <div className="rounded-lg border p-3">
            <div className="text-sm font-medium">召回数量</div>
            <p className="text-xs text-muted-foreground">每轮对话注入多少条知识片段。</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {[3, 4, 6, 8, 10].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => void saveSettings({ topK: value })}
                  disabled={loading || saving || !enabled}
                  className={`rounded-md px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
                    topK === value
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-background hover:bg-accent"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
