'use client';

import * as React from 'react';

import type {
  EcommerceAssistantStatus,
  ImageJob,
  ImageOutput,
  ProductInput,
  StylePreset,
} from './types';

interface AppData {
  status: EcommerceAssistantStatus | null;
  statusError: string | null;
  inputs: ProductInput[];
  jobs: ImageJob[];
  outputs: ImageOutput[];
  presets: StylePreset[];
  loading: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

export function useEcommerceAppData(): AppData {
  const [status, setStatus] = React.useState<EcommerceAssistantStatus | null>(null);
  const [statusError, setStatusError] = React.useState<string | null>(null);
  const [inputs, setInputs] = React.useState<ProductInput[]>([]);
  const [jobs, setJobs] = React.useState<ImageJob[]>([]);
  const [outputs, setOutputs] = React.useState<ImageOutput[]>([]);
  const [presets, setPresets] = React.useState<StylePreset[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const inFlightRef = React.useRef<AbortController | null>(null);
  const hasLoadedRef = React.useRef(false);

  const fetchAll = React.useCallback(async () => {
    inFlightRef.current?.abort();
    const ctrl = new AbortController();
    inFlightRef.current = ctrl;
    if (hasLoadedRef.current) setRefreshing(true);
    try {
      const [statusRes, inputsRes, jobsRes, presetsRes] = await Promise.all([
        fetchJson<EcommerceAssistantStatus>('/api/apps/builtin/ecommerce/status', ctrl.signal),
        fetchJson<{ items: ProductInput[] }>('/api/apps/builtin/ecommerce/inputs', ctrl.signal),
        fetchJson<{ jobs: ImageJob[]; outputs?: ImageOutput[] }>(
          '/api/apps/builtin/ecommerce/jobs?outputs=1',
          ctrl.signal,
        ),
        fetchJson<{ presets: StylePreset[] }>('/api/apps/builtin/ecommerce/presets', ctrl.signal),
      ]);
      if (ctrl.signal.aborted) return;
      if ('error' in statusRes) {
        setStatus(null);
        setStatusError(statusRes.error);
      } else {
        setStatus(statusRes.value);
        setStatusError(null);
      }
      setInputs('error' in inputsRes ? [] : inputsRes.value.items ?? []);
      if ('error' in jobsRes) {
        setJobs([]);
        setOutputs([]);
      } else {
        setJobs(jobsRes.value.jobs ?? []);
        setOutputs(jobsRes.value.outputs ?? []);
      }
      setPresets('error' in presetsRes ? [] : presetsRes.value.presets ?? []);
      hasLoadedRef.current = true;
    } finally {
      if (!ctrl.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  React.useEffect(() => {
    void fetchAll();
    return () => inFlightRef.current?.abort();
  }, [fetchAll]);

  return { status, statusError, inputs, jobs, outputs, presets, loading, refreshing, refresh: fetchAll };
}

type FetchResult<T> = { value: T } | { error: string };

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<FetchResult<T>> {
  try {
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: json.error ?? `请求 ${url} 失败 (${res.status})` };
    }
    const json = (await res.json()) as T;
    return { value: json };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
