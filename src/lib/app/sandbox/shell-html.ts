// Generates the shell HTML served at `lumos-app://{appId}/`. The iframe loads
// this, runs the bootstrap script, and mounts the user's compiled React app.
//
// The bootstrap is an inline ESM module — it requests handshake from the
// host, then dynamic-imports the entry page and mounts it under #root.

import type { ManifestV2 } from '@/lib/app/compile/types';

export interface ShellHtmlInput {
  appId: string;
  manifest: ManifestV2;
  /** Path under lumos-app://{appId}/ that serves the runtime bundle. */
  runtimePath?: string;
  /** Path under the protocol that serves the Tailwind CSS for this app. */
  tailwindCssPath?: string;
  /** Path of the entry page module (compiled output, served by the protocol). */
  entryModulePath: string;
}

export function buildShellHtml(input: ShellHtmlInput): string {
  const runtimePath = input.runtimePath ?? '/_runtime';
  const tailwindCssPath = input.tailwindCssPath ?? `${runtimePath}/tailwind.css`;
  const importmap = JSON.stringify({
    imports: {
      'react': `${runtimePath}/react.mjs`,
      'react/': `${runtimePath}/react/`,
      'react-dom': `${runtimePath}/react-dom.mjs`,
      'react-dom/': `${runtimePath}/react-dom/`,
      'react-dom/client': `${runtimePath}/react-dom-client.mjs`,
      'react/jsx-runtime': `${runtimePath}/react-jsx-runtime.mjs`,
      'react/jsx-dev-runtime': `${runtimePath}/react-jsx-runtime.mjs`,
      '@lumos/app': `${runtimePath}/lumos-app.mjs`,
      '@lumos/ui': `${runtimePath}/lumos-ui.mjs`,
      'lucide-react': `${runtimePath}/lucide-react.mjs`,
      'clsx': `${runtimePath}/clsx.mjs`,
      'tailwind-merge': `${runtimePath}/tailwind-merge.mjs`,
      'class-variance-authority': `${runtimePath}/cva.mjs`,
    },
  }, null, 2);

  const bootstrap = buildBootstrap(input);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.manifest.name)}</title>
  <link rel="stylesheet" href="${tailwindCssPath}" />
  <style>
    html, body, #root { height: 100%; margin: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', sans-serif;
      background: var(--background, white);
      color: var(--foreground, #0a0a0a);
    }
    #lumos-fallback {
      position: fixed; inset: 0; display: grid; place-items: center;
      font-size: 13px; color: #888;
    }
    #lumos-error {
      position: fixed; inset: 0; padding: 24px; overflow: auto;
      background: #fff; color: #b91c1c; font: 13px/1.5 ui-monospace, monospace;
      white-space: pre-wrap; display: none;
    }
    #lumos-error[data-shown="1"] { display: block; }
  </style>
  <script type="importmap">
${importmap}
  </script>
</head>
<body>
  <div id="root"></div>
  <div id="lumos-fallback">加载中…</div>
  <div id="lumos-error"></div>
  <script type="module">
${bootstrap}
  </script>
</body>
</html>
`;
}

function buildBootstrap(input: ShellHtmlInput): string {
  // The bootstrap is plain JS injected into the shell. It cannot reference
  // anything outside the iframe.
  return `
const fallback = document.getElementById('lumos-fallback');
const errorBox = document.getElementById('lumos-error');
const root = document.getElementById('root');

function fatal(err) {
  if (fallback) fallback.style.display = 'none';
  if (errorBox) {
    errorBox.dataset.shown = '1';
    errorBox.textContent = '加载应用失败：\\n' + (err && err.stack ? err.stack : String(err));
  }
  try {
    window.parent.postMessage({ type: 'sandbox-error', error: { message: String(err && err.message || err), stack: err && err.stack } }, '*');
  } catch {}
}

window.addEventListener('error', (e) => fatal(e.error || new Error(e.message)));
window.addEventListener('unhandledrejection', (e) => fatal(e.reason || new Error('unhandled rejection')));

(async () => {
  try {
    const [React, { createRoot }, { default: EntryPage }, app] = await Promise.all([
      import('react'),
      import('react-dom/client'),
      import(${JSON.stringify(input.entryModulePath)}),
      import('@lumos/app'),
    ]);

    // Tell host we're alive; wait for handshake (initial route + theme).
    window.parent.postMessage({ type: 'sandbox-ready' }, '*');
    await app.ready();

    if (fallback) fallback.remove();
    const reactRoot = createRoot(root);
    reactRoot.render(React.createElement(EntryPage));
  } catch (err) {
    fatal(err);
  }
})();
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
