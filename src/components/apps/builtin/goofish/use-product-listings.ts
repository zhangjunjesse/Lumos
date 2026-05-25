'use client';

import * as React from 'react';

import { APP_ID } from './use-goofish-app-data';

const COLLECTION = 'product_listings';

export type ListingStatus = 'live' | 'removed' | 'sold_out';
export type PublishStatus = 'never' | 'pending' | 'success' | 'failed';

export interface ProductListing {
  id: string;
  product_id: string;
  account_unb: string;
  account_label?: string;
  item_id: string;
  item_title: string;
  listed_price: number;
  listed_at: string;
  status: ListingStatus;
  sold_count?: number;
  updated_at?: string;
  /** 一键发布状态：never=未尝试 / pending=进行中 / success=已发布拿到 item_id / failed=最近一次失败 */
  publish_status?: PublishStatus;
  /** 最近一次发布失败的原因，成功时清空 */
  last_publish_error?: string;
  /** 最近一次发布尝试时间 */
  last_publish_at?: string;
}

export type ListingDraft = Partial<Omit<ProductListing, 'id'>>;

export interface UseProductListings {
  listings: ProductListing[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (draft: ListingDraft) => Promise<ProductListing | null>;
  update: (id: string, patch: ListingDraft) => Promise<ProductListing | null>;
  remove: (id: string) => Promise<boolean>;
}

const dataUrl = (params?: Record<string, string>): string => {
  const search = new URLSearchParams({ collection: COLLECTION, ...(params ?? {}) });
  return `/api/apps/${encodeURIComponent(APP_ID)}/data?${search.toString()}`;
};

export function useProductListings(productId?: string): UseProductListings {
  const [listings, setListings] = React.useState<ProductListing[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(dataUrl(), { cache: 'no-store' });
      const json = (await res.json().catch(() => ({}))) as { rows?: unknown; error?: string };
      if (!res.ok) throw new Error(json.error ?? '加载关联商品失败');
      let list = Array.isArray(json.rows)
        ? (json.rows as ProductListing[]).filter((r) => r && typeof r === 'object' && typeof r.id === 'string')
        : [];
      if (productId) list = list.filter((l) => l.product_id === productId);
      list.sort((a, b) => (b.listed_at ?? '').localeCompare(a.listed_at ?? ''));
      setListings(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载关联商品失败');
    } finally {
      setLoading(false);
    }
  }, [productId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = React.useCallback<UseProductListings['create']>(async (draft) => {
    try {
      const payload = {
        ...draft,
        listed_at: draft.listed_at ?? new Date().toISOString(),
      };
      const res = await fetch(dataUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as { row?: ProductListing; error?: string };
      if (!res.ok || !json.row) throw new Error(json.error ?? '创建关联失败');
      setListings((prev) => [json.row!, ...prev]);
      return json.row;
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建关联失败');
      return null;
    }
  }, []);

  const update = React.useCallback<UseProductListings['update']>(async (id, patch) => {
    try {
      const res = await fetch(dataUrl({ id }), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = (await res.json().catch(() => ({}))) as { row?: ProductListing; error?: string };
      if (!res.ok || !json.row) throw new Error(json.error ?? '更新关联失败');
      setListings((prev) => prev.map((l) => (l.id === id ? json.row! : l)));
      return json.row;
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新关联失败');
      return null;
    }
  }, []);

  const remove = React.useCallback<UseProductListings['remove']>(async (id) => {
    try {
      const res = await fetch(dataUrl({ id }), { method: 'DELETE' });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? '删除关联失败');
      setListings((prev) => prev.filter((l) => l.id !== id));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除关联失败');
      return false;
    }
  }, []);

  return { listings, loading, error, refresh, create, update, remove };
}
