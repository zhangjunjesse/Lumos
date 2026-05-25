'use client';

import * as React from 'react';

import { APP_ID, nativeActionUrl } from './use-goofish-app-data';

const COLLECTION = 'products';

export type ProductStatus = 'draft' | 'active' | 'archived';
export type LinkProvider = 'quark' | 'aliyun' | 'baidu' | 'lanzou' | '115' | 'other';
export type LinkHealth = 'ok' | 'broken' | 'unchecked';

export interface ProductLink {
  id: string;
  provider: LinkProvider;
  url: string;
  code: string;
  note: string;
  health: LinkHealth;
  last_checked_at: string | null;
}

export type CardKind = 'text' | 'data' | 'api' | 'image';

export interface ProductCard {
  id: string;
  kind: CardKind;
  name: string;
  enabled: boolean;
  delay_seconds: number;
  /** text 类型：每次发同样的文本（如固定教程链接 + 提取码） */
  text_content?: string;
  /** data 类型：多行卡密，一次一码出库 */
  data_lines?: string[];
  data_used_count?: number;
  /** api 类型：外部接口动态取卡 */
  api_config?: {
    url: string;
    method: 'GET' | 'POST';
    timeout_ms?: number;
    headers_json?: string;
    body_template?: string;
    response_jsonpath?: string;
  };
  /** image 类型：图片 URL（卡密图） */
  image_url?: string;
}

export interface Product {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  category: string;
  suggested_price: number;
  preview_image_paths: string[];
  source_pdf_path: string;
  ai_generated_titles: string[];
  ai_generated_description: string;
  links: ProductLink[];
  cards: ProductCard[];
  fulfillment_template: string;
  /** 议价底线（元）。AI 客服会被告知不允许低于这个价。0 或 undefined 表示不议价。 */
  min_price?: number;
  /** 商品级 AI 客服提示词（覆盖全局 ai_system_prompt）。空表示用全局默认。 */
  ai_prompt?: string;
  status: ProductStatus;
  total_sold: number;
  last_sold_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ProductDraft = Partial<Omit<Product, 'id'>>;

export const DEFAULT_FULFILLMENT_TEMPLATE = `亲，您下单的商品交付链接：
{{url}}
提取码：{{code}}
有问题随时联系～`;

export interface UseProducts {
  products: Product[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (draft: ProductDraft) => Promise<Product | null>;
  update: (id: string, patch: ProductDraft) => Promise<Product | null>;
  remove: (id: string) => Promise<boolean>;
}

const dataUrl = (params?: Record<string, string>): string => {
  const search = new URLSearchParams({ collection: COLLECTION, ...(params ?? {}) });
  return `/api/apps/${encodeURIComponent(APP_ID)}/data?${search.toString()}`;
};

export function useProducts(): UseProducts {
  const [products, setProducts] = React.useState<Product[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(dataUrl(), { cache: 'no-store' });
      const json = (await res.json().catch(() => ({}))) as { rows?: unknown; error?: string };
      if (!res.ok) throw new Error(json.error ?? '加载商品库失败');
      const list = Array.isArray(json.rows) ? json.rows.map(normalize).filter(isProduct) : [];
      list.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
      setProducts(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载商品库失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = React.useCallback<UseProducts['create']>(async (draft) => {
    try {
      const res = await fetch(dataUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serialize(draft)),
      });
      const json = (await res.json().catch(() => ({}))) as { row?: unknown; error?: string };
      const row = normalize(json.row);
      if (!res.ok || !isProduct(row)) throw new Error(json.error ?? '创建商品失败');
      setProducts((prev) => [row, ...prev]);
      setError(null);
      return row;
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建商品失败');
      return null;
    }
  }, []);

  const update = React.useCallback<UseProducts['update']>(async (id, patch) => {
    try {
      const res = await fetch(dataUrl({ id }), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serialize(patch)),
      });
      const json = (await res.json().catch(() => ({}))) as { row?: unknown; error?: string };
      const row = normalize(json.row);
      if (!res.ok || !isProduct(row)) throw new Error(json.error ?? '更新商品失败');
      setProducts((prev) => prev.map((r) => (r.id === id ? row : r)));
      setError(null);
      return row;
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新商品失败');
      return null;
    }
  }, []);

  const remove = React.useCallback<UseProducts['remove']>(async (id) => {
    try {
      const res = await fetch(nativeActionUrl('goofish', 'cascade-delete-product'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: id }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        removedListings?: number;
        orphanedLogs?: number;
      };
      if (!res.ok || !json.ok) throw new Error(json.message ?? '删除商品失败');
      setProducts((prev) => prev.filter((r) => r.id !== id));
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除商品失败');
      return false;
    }
  }, []);

  return { products, loading, error, refresh, create, update, remove };
}

function serialize(patch: ProductDraft): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch };
  if (Array.isArray(patch.tags)) out.tags = JSON.stringify(patch.tags);
  if (Array.isArray(patch.preview_image_paths)) {
    out.preview_image_paths = JSON.stringify(patch.preview_image_paths);
  }
  if (Array.isArray(patch.ai_generated_titles)) {
    out.ai_generated_titles = JSON.stringify(patch.ai_generated_titles);
  }
  if (Array.isArray(patch.links)) out.links = JSON.stringify(patch.links);
  if (Array.isArray(patch.cards)) out.cards = JSON.stringify(patch.cards);
  return out;
}

function normalize(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const r = value as Record<string, unknown>;
  return {
    ...r,
    tags: parseJsonArray<string>(r.tags),
    preview_image_paths: parseJsonArray<string>(r.preview_image_paths),
    ai_generated_titles: parseJsonArray<string>(r.ai_generated_titles),
    links: parseJsonArray<ProductLink>(r.links),
    cards: parseJsonArray<ProductCard>(r.cards),
    suggested_price: typeof r.suggested_price === 'number' ? r.suggested_price : 0,
    total_sold: typeof r.total_sold === 'number' ? r.total_sold : 0,
    fulfillment_template: typeof r.fulfillment_template === 'string'
      ? r.fulfillment_template
      : DEFAULT_FULFILLMENT_TEMPLATE,
    last_sold_at: typeof r.last_sold_at === 'string' ? r.last_sold_at : null,
  };
}

function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function isProduct(value: unknown): value is Product {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<Product>;
  return typeof r.id === 'string'
    && (r.status === undefined || r.status === 'draft' || r.status === 'active' || r.status === 'archived');
}
