'use client';

import * as React from 'react';

import { APP_ID, nativeActionUrl } from './use-goofish-app-data';

const COLLECTION = 'xianyu_items';

export interface XianyuItem {
  id: string;
  item_id: string;
  account_unb: string;
  title: string;
  price: number;
  price_text?: string;
  image_url?: string;
  item_status?: number;
  shipping_info?: string;
  want_count?: number;
  has_local_product?: boolean;
  first_seen_at?: string;
  last_synced_at?: string;
}

export interface UseXianyuItems {
  items: XianyuItem[];
  loading: boolean;
  syncing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  syncFromXianyu: (input: { accountUnb: string; browserContextId: string }) => Promise<{
    ok: boolean;
    upserted?: number;
    newItems?: number;
    totalFetched?: number;
    message: string;
  }>;
  linkToProduct: (input: {
    itemId: string;
    productId: string;
    accountUnb: string;
    itemTitle: string;
    price: number;
  }) => Promise<{ ok: boolean; message: string }>;
  refreshItem: (input: {
    itemId: string;
    accountUnb: string;
    rewriteDescription?: boolean;
    regenerateBanner?: boolean;
    overrideTitle?: string;
    overrideDescription?: string;
    overridePrice?: number;
  }) => Promise<{
    ok: boolean;
    newItemId?: string;
    newTitle?: string;
    newDescription?: string;
    message: string;
  }>;
}

const dataUrl = (params?: Record<string, string>): string => {
  const search = new URLSearchParams({ collection: COLLECTION, ...(params ?? {}) });
  return `/api/apps/${encodeURIComponent(APP_ID)}/data?${search.toString()}`;
};

export function useXianyuItems(accountUnb?: string): UseXianyuItems {
  const [items, setItems] = React.useState<XianyuItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [syncing, setSyncing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(dataUrl(), { cache: 'no-store' });
      const json = (await res.json().catch(() => ({}))) as { rows?: unknown; error?: string };
      if (!res.ok) throw new Error(json.error ?? '加载在售商品失败');
      let list = Array.isArray(json.rows) ? (json.rows as XianyuItem[]) : [];
      if (accountUnb) list = list.filter((it) => it.account_unb === accountUnb);
      list.sort((a, b) => (b.last_synced_at ?? '').localeCompare(a.last_synced_at ?? ''));
      setItems(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载在售商品失败');
    } finally {
      setLoading(false);
    }
  }, [accountUnb]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const syncFromXianyu = React.useCallback(async (input: { accountUnb: string; browserContextId: string }) => {
    setSyncing(true);
    try {
      const res = await fetch(nativeActionUrl('goofish', 'fetch-my-items'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        upserted?: number;
        newItems?: number;
        totalFetched?: number;
        message?: string;
      };
      if (!res.ok || !json.ok) {
        return { ok: false, message: json.message ?? '同步失败' };
      }
      await refresh();
      return {
        ok: true,
        upserted: json.upserted,
        newItems: json.newItems,
        totalFetched: json.totalFetched,
        message: json.message ?? '已同步',
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : '同步失败' };
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  const linkToProduct = React.useCallback(async (input: {
    itemId: string;
    productId: string;
    accountUnb: string;
    itemTitle: string;
    price: number;
  }) => {
    try {
      const res = await fetch(nativeActionUrl('goofish', 'link-xianyu-item-to-product'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !json.ok) {
        return { ok: false, message: json.message ?? '关联失败' };
      }
      await refresh();
      return { ok: true, message: json.message ?? '已关联' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : '关联失败' };
    }
  }, [refresh]);

  const refreshItem = React.useCallback(async (input: {
    itemId: string;
    accountUnb: string;
    rewriteDescription?: boolean;
    regenerateBanner?: boolean;
    overrideTitle?: string;
    overrideDescription?: string;
    overridePrice?: number;
  }) => {
    try {
      const res = await fetch(nativeActionUrl('goofish', 'refresh-xianyu-item'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        newItemId?: string;
        newTitle?: string;
        newDescription?: string;
        message?: string;
      };
      if (!res.ok || !json.ok) {
        return { ok: false, message: json.message ?? '刷新失败' };
      }
      await refresh();
      return {
        ok: true,
        newItemId: json.newItemId,
        newTitle: json.newTitle,
        newDescription: json.newDescription,
        message: json.message ?? '已 AI 优化并重新上架',
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : '刷新失败' };
    }
  }, [refresh]);

  return { items, loading, syncing, error, refresh, syncFromXianyu, linkToProduct, refreshItem };
}
