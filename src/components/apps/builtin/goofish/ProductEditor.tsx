'use client';

import * as React from 'react';
import { Loader2, Save, Sparkles, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

import { ProductBasicSection } from './ProductBasicSection';
import { ProductCardManager } from './ProductCardManager';
import { ProductLinkManager } from './ProductLinkManager';
import { ProductPreviewSection } from './ProductPreviewSection';
import { ProductListingsSection } from './ProductListingsSection';
import { DEFAULT_FULFILLMENT_TEMPLATE, type Product, type ProductDraft } from './use-products';

const EMPTY_DRAFT: ProductDraft = {
  title: '',
  summary: '',
  tags: [],
  category: '',
  suggested_price: 19.9,
  preview_image_paths: [],
  source_pdf_path: '',
  ai_generated_titles: [],
  ai_generated_description: '',
  links: [],
  cards: [],
  fulfillment_template: DEFAULT_FULFILLMENT_TEMPLATE,
  status: 'draft',
};

export function ProductEditor({
  product,
  onSave,
  onCancel,
  onDelete,
}: {
  product: Product | null;
  onSave: (patch: ProductDraft) => Promise<void> | void;
  onCancel?: () => void;
  onDelete?: () => Promise<void> | void;
}): React.ReactElement {
  const isNew = product === null;
  const [draft, setDraft] = React.useState<ProductDraft>(() =>
    product ? toDraft(product) : EMPTY_DRAFT,
  );
  const [saving, setSaving] = React.useState(false);
  const draftRef = React.useRef(draft);
  draftRef.current = draft;
  const productRef = React.useRef(product);

  React.useEffect(() => {
    const prev = productRef.current;
    productRef.current = product;
    if (prev && product && prev.id !== product.id) {
      const draftKey = JSON.stringify(draftRef.current);
      const prevKey = JSON.stringify(toDraft(prev));
      if (draftKey !== prevKey
        && typeof window !== 'undefined'
        && !window.confirm(`商品「${prev.title || '未命名'}」有未保存的修改，切换后会丢失。确定切到「${product.title || '未命名'}」？`)) {
        productRef.current = prev;
        return;
      }
    }
    setDraft(product ? toDraft(product) : EMPTY_DRAFT);
  }, [product]);

  const dirty = React.useMemo(() => {
    if (isNew) return true;
    return JSON.stringify(draft) !== JSON.stringify(toDraft(product!));
  }, [draft, product, isNew]);

  const patch = React.useCallback((next: ProductDraft) => {
    setDraft((prev) => ({ ...prev, ...next }));
  }, []);

  const submit = React.useCallback(async (overrides?: Partial<ProductDraft>) => {
    setSaving(true);
    try {
      const base = isNew
        ? { ...draft, created_at: new Date().toISOString() }
        : { ...draft };
      const payload = { ...base, ...(overrides ?? {}), updated_at: new Date().toISOString() };
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  }, [draft, isNew, onSave]);

  const publish = React.useCallback(async () => {
    const reason = validateForPublish(draft);
    if (reason) {
      if (typeof window !== 'undefined') window.alert(`无法上架：${reason}`);
      return;
    }
    await submit({ status: 'active' });
  }, [draft, submit]);

  const status: Product['status'] = draft.status ?? 'draft';

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-5">
        <header className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {isNew ? '新建商品' : draft.title || '未命名'}
          </h3>
          <div className="flex items-center gap-2">
            {isNew && onCancel ? (
              <Button variant="ghost" size="sm" onClick={onCancel}>
                <X className="size-3.5" /> 取消
              </Button>
            ) : null}
            {!isNew && status !== 'active' ? (
              <Button
                variant="default"
                size="sm"
                onClick={() => void publish()}
                disabled={saving}
                title="保存当前修改并把状态切到「在售」"
              >
                <Sparkles className="size-3.5" /> 上架
              </Button>
            ) : null}
            {!isNew && status === 'active' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void submit({ status: 'draft' })}
                disabled={saving}
                title="切回草稿；闲鱼商品仍在线，仅影响 Lumos 内的展示和扫描"
              >
                下架
              </Button>
            ) : null}
            <Button
              size="sm"
              variant={dirty ? 'default' : 'outline'}
              onClick={() => void submit()}
              disabled={!dirty || saving}
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {isNew ? '保存到商品库' : dirty ? '保存修改' : '已保存'}
            </Button>
          </div>
        </header>

        <ProductBasicSection product={product} draft={draft} onChange={patch} />

        <ProductLinkManager
          links={draft.links ?? []}
          template={draft.fulfillment_template ?? DEFAULT_FULFILLMENT_TEMPLATE}
          productId={product?.id ?? null}
          onChangeLinks={(links) => patch({ links })}
          onChangeTemplate={(fulfillment_template) => patch({ fulfillment_template })}
          onUpdateLinkImmediate={(links) => {
            patch({ links });
            if (product) void onSave({ ...draft, links, updated_at: new Date().toISOString() });
          }}
        />

        <ProductCardManager
          cards={draft.cards ?? []}
          onChange={(cards) => patch({ cards })}
        />

        <ProductPreviewSection product={product} draft={draft} onChange={patch} />

        {product ? (
          <ProductListingsSection productId={product.id} productTitle={product.title} />
        ) : null}

        {!isNew ? (
          <DangerZone
            status={status}
            onArchive={() => void onSave({ status: 'archived', updated_at: new Date().toISOString() })}
            onRestore={() => void onSave({ status: 'draft', updated_at: new Date().toISOString() })}
            onDelete={async () => {
              if (!onDelete) return;
              if (typeof window !== 'undefined'
                && !window.confirm('确认永久删除这件商品？\n关联商品记录会一起清掉；历史发货流水保留但被标记为「商品已删除」。不可恢复。')) return;
              await onDelete();
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function DangerZone({
  status,
  onArchive,
  onRestore,
  onDelete,
}: {
  status: Product['status'];
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
      {status === 'archived' ? (
        <Button variant="outline" size="sm" onClick={onRestore}>恢复为草稿</Button>
      ) : (
        <Button variant="outline" size="sm" onClick={onArchive}>归档</Button>
      )}
      <Button variant="destructive" size="sm" onClick={onDelete}>永久删除</Button>
    </div>
  );
}

function validateForPublish(draft: ProductDraft): string | null {
  if (!draft.title?.trim()) return '请先填写商品标题';
  const usableLinks = (draft.links ?? []).filter((l) => l.url?.trim() && l.health !== 'broken');
  const usableCards = (draft.cards ?? []).filter((c) => c.enabled !== false && isCardUsable(c));
  if (usableLinks.length === 0 && usableCards.length === 0) {
    return '至少配置 1 条可用的网盘链接 或 1 个卡密池';
  }
  if (!(draft.suggested_price && draft.suggested_price > 0)) return '请填写大于 0 的建议价格';
  return null;
}

function isCardUsable(card: { kind: string; text_content?: string; data_lines?: string[]; data_used_count?: number; api_config?: { url?: string }; image_url?: string }): boolean {
  if (card.kind === 'data') {
    const total = (card.data_lines ?? []).length;
    return total > (card.data_used_count ?? 0);
  }
  if (card.kind === 'text') return Boolean(card.text_content?.trim());
  if (card.kind === 'image') return Boolean(card.image_url?.trim());
  if (card.kind === 'api') return Boolean(card.api_config?.url?.trim());
  return false;
}

function toDraft(r: Product): ProductDraft {
  return {
    title: r.title,
    summary: r.summary,
    tags: r.tags,
    category: r.category,
    suggested_price: r.suggested_price,
    preview_image_paths: r.preview_image_paths,
    source_pdf_path: r.source_pdf_path,
    ai_generated_titles: r.ai_generated_titles,
    ai_generated_description: r.ai_generated_description,
    links: r.links,
    cards: r.cards,
    fulfillment_template: r.fulfillment_template,
    status: r.status,
  };
}
