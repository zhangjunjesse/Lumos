'use client';

import * as React from 'react';
import { Image as ImageIcon, Link2, Plus, Sparkles, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { ProductPipelineSection } from './ProductPipelineSection';
import { buildOnboardingAskAiPrompt, dispatchAskAi } from './ecommerce-ask-ai';

import type {
  EcommerceAssistantStatus,
  EcommerceTab,
  PipelineEntry,
  ProductInput,
} from './types';

interface StudioTabProps {
  status: EcommerceAssistantStatus | null;
  inputs: ProductInput[];
  pipeline: PipelineEntry[];
  loading: boolean;
  refreshing: boolean;
  onChanged: () => void;
  onJump: (target: EcommerceTab) => void;
  onOpenDetail?: (entry: PipelineEntry) => void;
}

export function StudioTab({
  status,
  inputs,
  pipeline,
  loading,
  refreshing,
  onChanged,
  onJump,
  onOpenDetail,
}: StudioTabProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [urlOpen, setUrlOpen] = React.useState(false);
  const ready = !!status?.providers.image.ok && !!status?.providers.analysis.ok;

  return (
    <div className="flex flex-col gap-6">
      <ProductPipelineSection
        entries={pipeline}
        loading={loading}
        onJump={onJump}
        onChanged={onChanged}
        onOpenDetail={onOpenDetail}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">出图流程</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <ul className="ml-5 list-disc text-muted-foreground">
            <li>两种入口：① 上传商品图 ② 粘贴商品 URL（走「设置 → 浏览器」里默认的 AdsPower / 内置浏览器抓取）。</li>
            <li>AI 自动识别 brief → 抠图 → 3 方向场景 → 评分选最优 → 终版精修 → 终版质检 → 生成 6 张详情图（白底主图 / 卖点特写 ×2 / 使用场景 ×2 / 尺寸参照）。</li>
            <li>抠图最多 2 次，场景最多 3 轮，精修最多 2 次；失败时自动降级到白底兜底，仍会生成详情图。</li>
            <li>所有图片按 kind 存档（main / cutout / catalog / lifestyle / campaign / detail-*），可重跑、下载、对比。</li>
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setOpen(true)} disabled={!ready}>
              <Plus className="size-4" />
              上传图片
            </Button>
            <Button onClick={() => setUrlOpen(true)} disabled={!ready} variant="secondary">
              <Link2 className="size-4" />
              从商品 URL 导入
            </Button>
            {!ready ? (
              <span className="text-xs text-amber-700 dark:text-amber-400">
                需要先在「设置 → 服务商」配置图像和分析 provider 后才能使用。
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">商品输入</CardTitle>
          <span className="text-xs text-muted-foreground">
            {refreshing ? '同步中…' : `${inputs.length} 条`}
          </span>
        </CardHeader>
        <CardContent>
          {loading && inputs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
          ) : inputs.length === 0 ? (
            <EmptyState onCreate={() => setOpen(true)} ready={ready} />
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {inputs.map((input) => (
                <InputCard key={input.id} input={input} onChanged={onChanged} ready={ready} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <CreateInputDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={() => {
          setOpen(false);
          onChanged();
        }}
      />

      <CreateFromUrlDialog
        open={urlOpen}
        onOpenChange={setUrlOpen}
        onCreated={() => {
          setUrlOpen(false);
          onChanged();
        }}
      />
    </div>
  );
}

function EmptyState({
  onCreate,
  ready,
}: {
  onCreate: () => void;
  ready: boolean;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed bg-muted/40 px-6 py-12 text-center">
      <ImageIcon className="size-8 text-muted-foreground" strokeWidth={1.4} />
      <div>
        <p className="text-sm font-medium">还没有商品输入</p>
        <p className="mt-1 text-xs text-muted-foreground">
          上传一张商品主图和参考图，开始你的第一次商品图生成。
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={onCreate} disabled={!ready}>
          <Plus className="size-4" />
          新建商品输入
        </Button>
        <Button
          variant="ghost"
          onClick={() => dispatchAskAi(buildOnboardingAskAiPrompt())}
        >
          <Sparkles className="size-4" />
          问 AI 怎么开始
        </Button>
      </div>
    </div>
  );
}

function InputCard({
  input,
  onChanged,
  ready,
}: {
  input: ProductInput;
  onChanged: () => void;
  ready: boolean;
}): React.ReactElement {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleStart = async () => {
    if (typeof window !== 'undefined' && !window.confirm(`确认基于「${input.title}」启动一次出图任务？任务会自动按 SOP 流程消耗图像配额。`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/apps/builtin/ecommerce/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input_id: input.id }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? '启动任务失败');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动任务失败');
    } finally {
      setBusy(false);
    }
  };

  const handleArchive = async () => {
    if (typeof window !== 'undefined' && !window.confirm(`将「${input.title}」归档？归档后不可再启动出图任务。`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/builtin/ecommerce/inputs/${input.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? '归档失败');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '归档失败');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (typeof window !== 'undefined' && !window.confirm(`永久删除「${input.title}」？已生成的任务记录会保留，但此输入不可恢复。`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/builtin/ecommerce/inputs/${input.id}`, { method: 'DELETE' });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? '删除失败');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded-md border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="truncate text-sm font-medium">{input.title}</h4>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {input.status}
        </span>
      </div>
      {input.category_hint ? (
        <p className="text-xs text-muted-foreground">类目：{input.category_hint}</p>
      ) : null}
      <p className="truncate text-xs text-muted-foreground">主图：{input.main_image_path}</p>
      {input.note ? <p className="text-xs text-muted-foreground">{input.note}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="mt-1 flex flex-wrap gap-2">
        <Button size="sm" onClick={handleStart} disabled={!ready || busy || input.status !== 'ready'}>
          {busy ? '启动中…' : '基于此输入出图'}
        </Button>
        {input.status === 'ready' ? (
          <Button size="sm" variant="ghost" onClick={handleArchive} disabled={busy}>
            归档
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={handleDelete} disabled={busy}>
          删除
        </Button>
      </div>
    </li>
  );
}

function CreateInputDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}): React.ReactElement {
  const [title, setTitle] = React.useState('');
  const [categoryHint, setCategoryHint] = React.useState('');
  const [note, setNote] = React.useState('');
  const [mainFile, setMainFile] = React.useState<File | null>(null);
  const [refFiles, setRefFiles] = React.useState<File[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reset = React.useCallback(() => {
    setTitle('');
    setCategoryHint('');
    setNote('');
    setMainFile(null);
    setRefFiles([]);
    setError(null);
  }, []);

  // Reset when the dialog closes — including the cancel/Esc paths — so the
  // next open starts from a clean slate instead of showing the previous draft.
  React.useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const submit = async () => {
    if (!title.trim()) {
      setError('商品标题不能为空');
      return;
    }
    if (!mainFile) {
      setError('请选择商品主图');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('title', title.trim());
      if (categoryHint.trim()) fd.append('category_hint', categoryHint.trim());
      if (note.trim()) fd.append('note', note.trim());
      fd.append('main_image', mainFile);
      for (const file of refFiles.slice(0, 4)) {
        fd.append('reference_images', file);
      }
      const res = await fetch('/api/apps/builtin/ecommerce/inputs', {
        method: 'POST',
        body: fd,
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? '上传失败');
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建商品输入</DialogTitle>
          <DialogDescription>
            上传一张商品主图（必填）和最多 4 张参考图。AI 会基于这些图片识别商品 brief 并生成商品图。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="title">商品标题</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：北欧实木茶几" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="category">类目（可选）</Label>
            <Input id="category" value={categoryHint} onChange={(e) => setCategoryHint(e.target.value)} placeholder="例如：家具 / 家居 / 美妆" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="main">商品主图</Label>
            <Input id="main" type="file" accept="image/*" onChange={(e) => setMainFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="refs">参考图（最多 4 张）</Label>
            <Input
              id="refs"
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setRefFiles(Array.from(e.target.files ?? []).slice(0, 4))}
            />
            {refFiles.length > 0 ? (
              <p className="text-xs text-muted-foreground">已选 {refFiles.length} 张</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="note">备注（可选）</Label>
            <Textarea id="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="补充想强调的卖点 / 风格 / 禁忌" />
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={submit} disabled={busy}>
            <Upload className="size-4" />
            {busy ? '上传中…' : '保存输入'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CreateFromUrlResult {
  input_id?: string;
  adapter?: string;
  llm_fallback_used?: boolean;
  gallery_count?: number;
  warnings?: string[];
  parsed?: {
    title?: string | null;
    price?: string | null;
    bullet_count?: number;
  };
  job?: { id?: string };
  job_start_error?: string;
  error?: string;
  stage?: string;
}

function CreateFromUrlDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}): React.ReactElement {
  const [url, setUrl] = React.useState('');
  const [autoStart, setAutoStart] = React.useState(true);
  const [titleOverride, setTitleOverride] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CreateFromUrlResult | null>(null);

  React.useEffect(() => {
    if (!open) {
      setUrl('');
      setAutoStart(true);
      setTitleOverride('');
      setError(null);
      setResult(null);
    }
  }, [open]);

  const submit = async () => {
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      setError('请输入完整的 http(s) 商品 URL。');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/apps/builtin/ecommerce/inputs/from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: trimmed,
          auto_start: autoStart,
          title_override: titleOverride.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as CreateFromUrlResult;
      if (!res.ok) {
        throw new Error(json.error ?? '导入失败');
      }
      setResult(json);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>从商品 URL 导入</DialogTitle>
          <DialogDescription>
            粘贴 Amazon / Tmall / Etsy / Shopify 等商品详情页 URL，AI 会通过「设置 → 浏览器」里默认的 AdsPower（或内置浏览器）抓取主图、标题、卖点，并按标准 SOP 出图 + 6 张详情图。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="url">商品 URL</Label>
            <Input
              id="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.amazon.com/dp/..."
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="title-override">商品标题覆盖（可选）</Label>
            <Input
              id="title-override"
              value={titleOverride}
              onChange={(e) => setTitleOverride(e.target.value)}
              placeholder="留空则使用页面标题"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              id="auto-start"
              checked={autoStart}
              onCheckedChange={(checked) => setAutoStart(checked === true)}
            />
            <span>导入成功后立即启动出图任务</span>
          </label>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {result ? (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
              <p>
                导入成功 · adapter: <code>{result.adapter}</code>
                {result.llm_fallback_used ? '（LLM 兜底）' : ''} · 主图 1 张
                {result.gallery_count ? ` + ${result.gallery_count} 张参考` : ''}
              </p>
              {result.parsed?.title ? <p className="mt-1 truncate">标题：{result.parsed.title}</p> : null}
              {result.parsed?.price ? <p>价格：{result.parsed.price}</p> : null}
              {result.parsed?.bullet_count ? <p>卖点：{result.parsed.bullet_count} 条</p> : null}
              {result.job?.id ? <p className="mt-1 text-emerald-700 dark:text-emerald-400">已启动出图任务 {result.job.id}</p> : null}
              {result.job_start_error ? (
                <p className="mt-1 text-amber-700 dark:text-amber-400">任务未启动：{result.job_start_error}</p>
              ) : null}
              {result.warnings && result.warnings.length > 0 ? (
                <ul className="ml-4 mt-1 list-disc text-amber-700 dark:text-amber-400">
                  {result.warnings.map((w) => (<li key={w}>{w}</li>))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {result ? '关闭' : '取消'}
          </Button>
          {!result ? (
            <Button onClick={submit} disabled={busy}>
              <Link2 className="size-4" />
              {busy ? '抓取中…' : '导入商品'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
