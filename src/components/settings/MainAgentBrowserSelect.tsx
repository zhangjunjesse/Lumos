"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BrowserProviderConfigView } from "@/types";

const EMBEDDED = "embedded:default";

interface Props {
  configs: BrowserProviderConfigView[];
}

// 主 Agent 默认浏览器选择器。
// 主 Agent 每天自动新建会话、自动运行（睡眠轮转 / 定时 / IM 触发），没人手动选浏览器，
// 这里配的就是它新会话默认接管的浏览器；选「内置」= 清空设置走默认。
export function MainAgentBrowserSelect({ configs }: Props) {
  const [value, setValue] = useState<string>(EMBEDDED);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/settings/app");
        const data = await res.json();
        const v = (data?.settings?.main_agent_browser_context || "").trim();
        if (!cancelled) setValue(v || EMBEDDED);
      } catch {
        /* 读失败保持内置 */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (next: string) => {
    setValue(next);
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { main_agent_browser_context: next === EMBEDDED ? "" : next },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "保存失败");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, []);

  const options = configs.filter((config) => config.enabled === 1);

  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">主 Agent 默认浏览器</p>
          <p className="mt-1 text-xs text-muted-foreground">
            主 Agent 每天自动新建会话时默认接管的浏览器。自动运行没人手动选，就用这里的配置。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(loading || saving) && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
          <Select value={value} onValueChange={(v) => void save(v)} disabled={loading || saving}>
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={EMBEDDED}>内置浏览器</SelectItem>
                {options.map((config) => (
                  <SelectItem key={config.context_id} value={config.context_id}>
                    {config.display_name}（{config.context_id}）
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
