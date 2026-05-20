"use client";

import { useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// 查看/修改"总结"用的系统提示词。影响所有会话总结（夜间睡眠 + 理解总结）。
export function DigestPromptDialog() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [defaultPrompt, setDefaultPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError("");
    fetch("/api/memory-v2/digest-prompt", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setValue(d.prompt || "");
        setIsCustom(Boolean(d.isCustom));
        setDefaultPrompt(d.defaultPrompt || "");
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open]);

  async function persist(prompt: string) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/memory-v2/digest-prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d) throw new Error(d?.error || `保存失败（HTTP ${res.status}）`);
      setValue(d.prompt || "");
      setIsCustom(Boolean(d.isCustom));
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <FileText className="mr-1.5 h-3.5 w-3.5" />
          总结提示词
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>总结提示词</DialogTitle>
          <DialogDescription>
            决定 AI 怎么总结每个会话（意图/结果/失败点）。改了对所有会话总结生效：夜间睡眠和「理解总结」都用它。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            加载中...
          </div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground">
              当前：{isCustom ? "自定义" : "内置默认"}
            </div>
            <Textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="min-h-64 font-mono text-xs leading-5"
              placeholder="留空保存即恢复内置默认"
            />
            {error && <div className="text-xs text-rose-700">{error}</div>}
          </>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving || loading || !isCustom}
            onClick={() => persist("")}
          >
            恢复默认
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saving || loading || value.trim() === defaultPrompt.trim() && !isCustom}
              onClick={() => persist(value)}
            >
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
