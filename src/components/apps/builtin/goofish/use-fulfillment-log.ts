'use client';

import * as React from 'react';

import { APP_ID, nativeActionUrl } from './use-goofish-app-data';

const COLLECTION = 'fulfillment_log';

export type FulfillmentTrigger = 'auto_scan' | 'manual_button' | 'ai_in_chat';
export type FulfillmentStatus = 'pending' | 'sent' | 'failed' | 'duplicate_skip';

export interface FulfillmentLogRow {
  id: string;
  trigger_source: FulfillmentTrigger;
  conversation_id: string;
  buyer_user_id: string;
  buyer_name: string;
  account_unb: string;
  item_id: string;
  item_title: string;
  product_id: string;
  product_title?: string;
  product_listing_id?: string;
  detected_message_id?: string;
  detection_keyword?: string;
  sent_text: string;
  status: FulfillmentStatus;
  failure_reason?: string;
  sent_at?: string;
  created_at: string;
}

export interface UseFulfillmentLog {
  rows: FulfillmentLogRow[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  retry: (id: string) => Promise<void>;
}

const dataUrl = (params?: Record<string, string>): string => {
  const search = new URLSearchParams({ collection: COLLECTION, ...(params ?? {}) });
  return `/api/apps/${encodeURIComponent(APP_ID)}/data?${search.toString()}`;
};

export function useFulfillmentLog(): UseFulfillmentLog {
  const [rows, setRows] = React.useState<FulfillmentLogRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(dataUrl(), { cache: 'no-store' });
      const json = (await res.json().catch(() => ({}))) as { rows?: unknown; error?: string };
      if (!res.ok) throw new Error(json.error ?? '加载发货流水失败');
      const list = Array.isArray(json.rows) ? (json.rows as FulfillmentLogRow[]) : [];
      list.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
      setRows(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载发货流水失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const retry = React.useCallback(async (id: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    try {
      const res = await fetch(nativeActionUrl('goofish', 'retry-fulfillment'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logId: id }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !json.ok) throw new Error(json.message ?? '重发失败');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '重发失败');
    }
  }, [rows, refresh]);

  return { rows, loading, error, refresh, retry };
}
