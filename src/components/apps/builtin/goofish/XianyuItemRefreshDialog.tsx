'use client';

import * as React from 'react';
import { Loader2, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import type { XianyuItem } from './use-xianyu-items';

/**
 * AI 优化 + 下架重发对话框。
 * 闲鱼 PC 网页没有真正的「编辑商品」接口，标准玩法是删除重发（也顺便擦亮）。
 * 这里展示选项 + 让用户确认后调 refresh-xianyu-item。
 */
export function XianyuItemRefreshDialog({
  item,
  accountUnb,
  onClose,
  onConfirm,
}: {
  item: XianyuItem;
  accountUnb: string;
  onClose: () => void;
  onConfirm: (opts: {
    rewriteDescription: boolean;
    regenerateBanner: boolean;
    overrideTitle?: string;
    overrideDescription?: string;
    overridePrice?: number;
  }) => Promise<{ ok: boolean; message: string; newItemId?: string }>;
}): React.ReactElement {
  const [rewriteDescription, setRewriteDescription] = React.useState(true);
  const [regenerateBanner, setRegenerateBanner] = React.useState(false);
  const [title, setTitle] = React.useState(item.title);
  const [description, setDescription] = React.useState('');
  const [price, setPrice] = React.useState(item.price || 0);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const submit = async () => {
    if (typeof window !== 'undefined'
      && !window.confirm('确认 AI 优化并重新上架？\n整流程约 2-3 分钟，期间不要关闭窗口。')) {
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const r = await onConfirm({
        rewriteDescription,
        regenerateBanner,
        overrideTitle: title !== item.title ? title : undefined,
        overrideDescription: description.trim() || undefined,
        overridePrice: price !== item.price ? price : undefined,
      });
      setResult({ ok: r.ok, message: r.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h3 className="text-sm font-semibold">AI 优化并重新上架</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            闲鱼 PC 端无「编辑」接口；卖家圈标准做法 = 下架重发（顺便擦亮提排名）。
            <br />原 item_id <code className="rounded bg-muted px-1 font-mono">{item.item_id}</code> 会被替换为新 id，关联自动迁移。
          </p>
          <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
            ⏱ 整流程 2-3 分钟：AI 写描述 ~10s → AI 生图 ~30s → 下架 ~5s → <b>等闲鱼写操作限流冷却 65s</b> → 重新发布 ~30s。请耐心等，不要关页面。
          </p>
        </header>

        <div className="mt-4 space-y-4">
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">AI 选项</p>
            <label className="mt-2 flex items-start gap-2 text-sm">
              <Checkbox
                checked={rewriteDescription}
                onCheckedChange={(c) => setRewriteDescription(Boolean(c))}
                disabled={busy}
              />
              <div>
                <p>AI 重写商品描述</p>
                <p className="text-[11px] text-muted-foreground">用 80-150 字「亮点+人群+交付」三段格式</p>
              </div>
            </label>
            <label className="mt-2 flex items-start gap-2 text-sm">
              <Checkbox
                checked={regenerateBanner}
                onCheckedChange={(c) => setRegenerateBanner(Boolean(c))}
                disabled={busy}
              />
              <div>
                <p>AI 重新生成主图（1:1 banner）</p>
                <p className="text-[11px] text-muted-foreground">关闭时沿用原图（自动下载重传）</p>
              </div>
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">标题（可改）</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              className="text-sm"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">手动指定描述（留空就用 AI 重写或保留原描述）</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              disabled={busy}
              className="text-xs"
              placeholder="例：长期出，假一赔十，下午 5 点前下单当天发"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">价格（¥）</Label>
            <Input
              type="number"
              min={0}
              step={0.1}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value) || 0)}
              disabled={busy}
              className="text-sm"
            />
          </div>

          {busy ? (
            <p className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-2 text-xs text-blue-700 dark:text-blue-300">
              <Loader2 className="mr-1 inline size-3 animate-spin" />
              正在执行 4 步流程，预计 2-3 分钟（已含 65s 限流冷却）。请耐心等，HTTP 请求会一直挂着不要关。
            </p>
          ) : null}
          {result ? (
            <p className={result.ok
              ? 'rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs text-emerald-700 dark:text-emerald-300'
              : 'rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive'}>
              {result.message}
            </p>
          ) : null}
        </div>

        <footer className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            {result?.ok ? '关闭' : '取消'}
          </Button>
          {!result?.ok ? (
            <Button size="sm" onClick={() => void submit()} disabled={busy || !accountUnb}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              确认 AI 优化并重发
            </Button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
