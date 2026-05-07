'use client';

import * as React from 'react';

export interface ContactRow {
  id: string;
  name: string;
  isGroup: boolean;
}

export interface UseContactsResult {
  contacts: ContactRow[];
  ready: boolean;
  reason: string | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
}

/**
 * Lazy-loads the WeChat contact list from `/api/apps/builtin/wechat/contacts`.
 * Caller decides when to fetch (typically when the picker dialog opens) so we
 * don't pay the api.py spawn cost on every settings page load.
 */
export function useWeChatContacts(): UseContactsResult {
  const [contacts, setContacts] = React.useState<ContactRow[]>([]);
  const [ready, setReady] = React.useState(false);
  const [reason, setReason] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const loadedRef = React.useRef(false);

  const load = React.useCallback(async () => {
    if (loadedRef.current) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/apps/builtin/wechat/contacts', { cache: 'no-store' });
      const json = (await res.json().catch(() => ({}))) as {
        ready?: boolean;
        reason?: string;
        contacts?: ContactRow[];
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(json.message ?? json.error ?? '联系人加载失败');
      }
      if (json.ready && !Array.isArray(json.contacts)) {
        throw new Error('联系人返回异常');
      }
      setReady(Boolean(json.ready));
      setReason(json.reason ?? null);
      setContacts((json.contacts ?? []).filter(isContactRow));
      loadedRef.current = Boolean(json.ready);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  return { contacts, ready, reason, loading, error, load };
}

function isContactRow(value: unknown): value is ContactRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<ContactRow>;
  return typeof row.id === 'string' && typeof row.name === 'string' && typeof row.isGroup === 'boolean';
}
