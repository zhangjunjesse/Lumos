'use client';

import * as React from 'react';

import { dispatchRpc, type DispatcherAdapters } from '@/lib/app/sandbox/dispatcher';
import type { ManifestV2 } from '@/lib/app/compile/types';
import {
  isRpcRequest,
  type HandshakeResponse,
} from '@/lib/app/sandbox/protocol';
import { cn } from '@/lib/utils';

interface SandboxIframeProps {
  /** Full URL to load — e.g. `lumos-app://builder-abc123/`. */
  src: string;
  /** Manifest is required for permission checks during dispatch. */
  manifest: ManifestV2;
  /** Adapter functions wired into the dispatcher (db / ai / workflow / etc.). */
  adapters: DispatcherAdapters;
  /** Initial route + theme, sent in handshake response. */
  initialRoute?: { id: string; params?: Record<string, string> };
  theme?: 'light' | 'dark';
  /** Forwarded to outer container; iframe itself is `w-full h-full`. */
  className?: string;
  /** Reload counter — bumping it forces the iframe to reload. */
  reloadKey?: number;
  /** Called when the iframe reports an unrecoverable error (white screen, exception). */
  onSandboxError?: (info: { message: string; stack?: string }) => void;
  /** Called once when the iframe finishes its handshake. */
  onReady?: () => void;
}

/**
 * Hosts an AI-generated React app in an iframe loaded via `lumos-app://`.
 * The iframe uses postMessage to call the platform APIs (`@lumos/app`); this
 * component receives the messages and dispatches them through the host RPC
 * dispatcher (which talks to SQLite / AI / workflow runtimes).
 */
export function SandboxIframe({
  src,
  manifest,
  adapters,
  initialRoute,
  theme = 'light',
  className,
  reloadKey = 0,
  onSandboxError,
  onReady,
}: SandboxIframeProps): React.ReactElement {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState<{ message: string; stack?: string } | null>(null);

  // Re-create iframe element when src or reloadKey changes; React handles via key.
  const iframeKey = `${src}#${reloadKey}`;

  React.useEffect(() => {
    setReady(false);
    setError(null);
  }, [iframeKey]);

  React.useEffect(() => {
    function postToSandbox(message: unknown): void {
      iframeRef.current?.contentWindow?.postMessage(message, '*');
    }

    async function handleMessage(event: MessageEvent): Promise<void> {
      // Only accept messages from our own iframe.
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      const t = (data as { type?: string }).type;

      if (t === 'sandbox-ready') {
        // Sandbox bootstrap finished; send handshake.
        const handshake: HandshakeResponse = {
          version: 1,
          initialRoute: {
            id: initialRoute?.id ?? manifest.entry,
            params: initialRoute?.params ?? {},
          },
          theme,
          manifest,
        };
        postToSandbox({ type: 'app.handshake.response', payload: handshake });
        setReady(true);
        onReady?.();
        return;
      }

      if (t === 'sandbox-error') {
        const info = (data as { error?: { message?: string; stack?: string } }).error;
        const sanitized = {
          message: info?.message ?? 'unknown sandbox error',
          stack: info?.stack,
        };
        setError(sanitized);
        onSandboxError?.(sanitized);
        return;
      }

      if (isRpcRequest(data)) {
        try {
          const response = await dispatchRpc(data, {
            appId: manifest.id,
            manifest,
            adapters,
          });
          postToSandbox(response);
        } catch (err) {
          postToSandbox({
            id: data.id,
            type: 'rpc-response',
            error: {
              code: 'INTERNAL',
              message: err instanceof Error ? err.message : String(err),
            },
          });
        }
        return;
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [adapters, initialRoute?.id, initialRoute?.params, manifest, onReady, onSandboxError, theme]);

  return (
    <div className={cn('relative h-full w-full overflow-hidden bg-background', className)}>
      {!ready && !error ? (
        <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
          应用启动中…
        </div>
      ) : null}
      {error ? (
        <SandboxErrorOverlay error={error} onDismiss={() => setError(null)} />
      ) : null}
      <iframe
        key={iframeKey}
        ref={iframeRef}
        src={src}
        sandbox="allow-scripts allow-forms"
        className="h-full w-full border-0"
        title={manifest.name}
      />
    </div>
  );
}

function SandboxErrorOverlay({
  error,
  onDismiss,
}: {
  error: { message: string; stack?: string };
  onDismiss: () => void;
}): React.ReactElement {
  return (
    <div className="absolute inset-0 flex flex-col gap-3 overflow-auto bg-background/95 p-6 backdrop-blur-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-semibold text-destructive">应用运行出错</div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded text-xs text-muted-foreground hover:text-foreground"
        >
          关闭
        </button>
      </div>
      <pre className="max-h-full overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed text-destructive/90">
        {error.stack ?? error.message}
      </pre>
    </div>
  );
}
