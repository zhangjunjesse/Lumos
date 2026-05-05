'use client';

import * as React from 'react';

import type {
  ConsentRequest,
  ConsentResponse,
  InstalledApp,
} from '@/lib/app/installer';

type UploadResult =
  | { kind: 'ok'; installed?: InstalledApp }
  | { kind: 'needs-consent'; request: ConsentRequest }
  | { kind: 'error'; message: string };

export function useAppInstall(onInstalled: () => Promise<void> | void) {
  const [installing, setInstalling] = React.useState(false);
  const [pendingFile, setPendingFile] = React.useState<File | null>(null);
  const [pendingRequest, setPendingRequest] = React.useState<ConsentRequest | null>(null);

  const upload = React.useCallback(
    async (file: File, consent: ConsentResponse | null): Promise<UploadResult> => {
      const form = new FormData();
      form.append('file', file);
      form.append('source', 'local');
      if (consent) form.append('consent', JSON.stringify(consent));
      const res = await fetch('/api/apps', { method: 'POST', body: form });
      const json = (await res.json()) as {
        ok?: boolean;
        installed?: InstalledApp;
        error?: string;
        message?: string;
        needsConsent?: boolean;
        request?: ConsentRequest;
      };
      if (json.needsConsent && json.request) {
        return { kind: 'needs-consent', request: json.request };
      }
      if (!res.ok || json.ok === false) {
        return { kind: 'error', message: json.message ?? json.error ?? `HTTP ${res.status}` };
      }
      return { kind: 'ok', installed: json.installed };
    },
    [],
  );

  const handleFile = React.useCallback(
    async (file: File) => {
      setInstalling(true);
      try {
        const res = await upload(file, null);
        if (res.kind === 'needs-consent') {
          setPendingFile(file);
          setPendingRequest(res.request);
        } else if (res.kind === 'ok') {
          await onInstalled();
        } else {
          window.alert(`安装失败：${res.message}`);
        }
      } finally {
        setInstalling(false);
      }
    },
    [upload, onInstalled],
  );

  const handleConsent = React.useCallback(
    async (response: ConsentResponse) => {
      if (!pendingFile) return;
      setInstalling(true);
      try {
        const res = await upload(pendingFile, response);
        setPendingFile(null);
        setPendingRequest(null);
        if (res.kind === 'ok') {
          await onInstalled();
        } else if (res.kind === 'error') {
          window.alert(`安装失败：${res.message}`);
        }
      } finally {
        setInstalling(false);
      }
    },
    [pendingFile, upload, onInstalled],
  );

  const cancelConsent = React.useCallback(() => {
    setPendingFile(null);
    setPendingRequest(null);
  }, []);

  return { installing, pendingRequest, handleFile, handleConsent, cancelConsent };
}
