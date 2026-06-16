'use client';

// 产品开发 — listing 编辑器:本地乐观更新 + 防抖落库(600ms)。各子 tab 通过 patch() 改字段，自动存。
// 状态切换等要立即生效的，调 patch 后 flush()。

import { useCallback, useEffect, useRef, useState } from 'react';
import { listingApi, type ListingRow } from './listing-api';

export interface SectionProps {
  listing: ListingRow;
  patch: (p: Partial<ListingRow>) => void;
  flush: () => Promise<void>;
}

export function useListingEditor(initial: ListingRow) {
  const [listing, setListing] = useState<ListingRow>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<Partial<ListingRow>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const patchObj = pendingRef.current;
    if (Object.keys(patchObj).length === 0) return;
    pendingRef.current = {};
    setSaving(true);
    setError(null);
    try {
      const r = await listingApi.update(initial.id, patchObj);
      // 用服务端回包(含 updated_at)，再叠加 await 期间新进的 pending，避免回退。
      setListing((prev) => ({ ...prev, ...r.listing, ...pendingRef.current }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [initial.id]);

  const patch = useCallback(
    (p: Partial<ListingRow>) => {
      setListing((prev) => ({ ...prev, ...p }));
      pendingRef.current = { ...pendingRef.current, ...p };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), 600);
    },
    [flush],
  );

  // 卸载前把未落库的存掉。
  useEffect(() => () => void flush(), [flush]);

  return { listing, setListing, patch, flush, saving, error };
}
