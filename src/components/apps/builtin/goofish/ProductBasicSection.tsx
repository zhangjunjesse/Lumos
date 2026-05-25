'use client';

import * as React from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { APP_ID, nativeActionUrl } from './use-goofish-app-data';
import type { Product, ProductDraft } from './use-products';

const CATEGORIES = ['行业研究', 'AI 教程', '考研资料', '简历模板', 'PPT 模板', '其他'];

export function ProductBasicSection({
  product,
  draft,
  onChange,
}: {
  product: Product | null;
  draft: ProductDraft;
  onChange: (patch: ProductDraft) => void;
}): React.ReactElement {
  const [busy, setBusy] = React.useState<'title' | 'description' | null>(null);
  const [titleIndex, setTitleIndex] = React.useState(0);

  React.useEffect(() => {
    setTitleIndex(0);
  }, [product?.id]);

  const generate = React.useCallback(
    async (kind: 'title' | 'description') => {
      setBusy(kind);
      try {
        const res = await fetch(nativeActionUrl('goofish', 'generate-product-content'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind,
            title: draft.title ?? '',
            summary: draft.summary ?? '',
            category: draft.category ?? '',
            tags: draft.tags ?? [],
            existingDescription: draft.ai_generated_description ?? '',
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          titles?: string[];
          description?: string;
          message?: string;
        };
        if (!res.ok || !json.ok) throw new Error(json.message ?? '生成失败');
        if (kind === 'title' && Array.isArray(json.titles) && json.titles.length > 0) {
          onChange({ ai_generated_titles: json.titles, title: json.titles[0] });
          setTitleIndex(0);
        }
        if (kind === 'description' && typeof json.description === 'string') {
          onChange({ ai_generated_description: json.description, summary: json.description });
        }
      } catch (err) {
        if (typeof window !== 'undefined') {
          window.alert(err instanceof Error ? err.message : 'AI 生成失败');
        }
      } finally {
        setBusy(null);
      }
    },
    [draft, onChange],
  );

  const switchTitle = React.useCallback(() => {
    const list = draft.ai_generated_titles ?? [];
    if (list.length === 0) return;
    const next = (titleIndex + 1) % list.length;
    setTitleIndex(next);
    onChange({ title: list[next] });
  }, [draft.ai_generated_titles, titleIndex, onChange]);

  return (
    <section className="flex flex-col gap-3">
      <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        基础信息
      </h4>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="product-title" className="text-xs">标题</Label>
        <div className="flex gap-2">
          <Input
            id="product-title"
            value={draft.title ?? ''}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="例：2024 东南亚跨境电商分析合集"
            className="text-sm"
          />
          {(draft.ai_generated_titles?.length ?? 0) > 1 ? (
            <Button variant="outline" size="sm" onClick={switchTitle} type="button">
              换一个 ({titleIndex + 1}/{draft.ai_generated_titles!.length})
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void generate('title')}
            disabled={busy !== null}
            type="button"
          >
            {busy === 'title'
              ? <Loader2 className="size-3.5 animate-spin" />
              : <Sparkles className="size-3.5" />}
            AI 候选
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="product-summary" className="text-xs">商品描述</Label>
        <Textarea
          id="product-summary"
          value={draft.summary ?? ''}
          onChange={(e) => onChange({ summary: e.target.value })}
          placeholder="200 页 / 含原始数据 / 适合做出海决策的参考"
          rows={4}
          className="text-sm"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => void generate('description')}
          disabled={busy !== null}
          type="button"
          className="self-start"
        >
          {busy === 'description'
            ? <Loader2 className="size-3.5 animate-spin" />
            : <Sparkles className="size-3.5" />}
          AI 重新生成
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-category" className="text-xs">分类</Label>
          <select
            id="product-category"
            value={draft.category ?? ''}
            onChange={(e) => onChange({ category: e.target.value })}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">未分类</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-price" className="text-xs">挂牌价格（元）</Label>
          <Input
            id="product-price"
            type="number"
            min={0}
            step={0.1}
            value={draft.suggested_price ?? 0}
            onChange={(e) => onChange({ suggested_price: Number(e.target.value) || 0 })}
            className="text-sm"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="product-min-price" className="text-xs">
          议价底线（元）
          <span className="ml-1 font-normal text-muted-foreground">买家砍价时 AI 不允许低于这个价，留空或填 0 = 不让步</span>
        </Label>
        <Input
          id="product-min-price"
          type="number"
          min={0}
          step={0.1}
          value={draft.min_price ?? 0}
          onChange={(e) => onChange({ min_price: Number(e.target.value) || 0 })}
          className="text-sm"
          placeholder="例：15"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="product-ai-prompt" className="text-xs">
          商品级 AI 客服提示词
          <span className="ml-1 font-normal text-muted-foreground">覆盖全局提示词。写「这商品独有的卖点 / 回复风格 / 不能承诺的事」</span>
        </Label>
        <Textarea
          id="product-ai-prompt"
          value={draft.ai_prompt ?? ''}
          onChange={(e) => onChange({ ai_prompt: e.target.value })}
          rows={3}
          placeholder={'例：\n- 强调"知识付费类，售出后不支持退款"\n- 7×24 在线，5 分钟内响应\n- 议价请直接报心理价位，不接受"便宜点"等模糊提问'}
          className="text-xs"
        />
      </div>

      <TagEditor
        tags={draft.tags ?? []}
        onChange={(tags) => onChange({ tags })}
      />

      <input type="hidden" name="appId" value={APP_ID} />
    </section>
  );
}

function TagEditor({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}): React.ReactElement {
  const [input, setInput] = React.useState('');
  const add = () => {
    const v = input.trim();
    if (!v) return;
    if (tags.includes(v)) {
      setInput('');
      return;
    }
    onChange([...tags, v]);
    setInput('');
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">标签</Label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5">
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]"
          >
            {t}
            <button
              type="button"
              onClick={() => onChange(tags.filter((x) => x !== t))}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder={tags.length === 0 ? '回车添加标签' : ''}
          className="flex-1 bg-transparent text-xs focus:outline-none"
        />
      </div>
    </div>
  );
}
