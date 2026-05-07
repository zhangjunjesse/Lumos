// Client-safe utilities for converting between builder session ids and
// the appId used in the lumos-app:// protocol URL.
//
// Kept in a separate file so client bundles can import these without
// pulling esbuild in via app-loader.ts.

/** appId for builder previews: `builder-{encoded-session-id}`, kebab-case, ≤64 chars. */
export function builderAppId(sessionId: string): string {
  const encoded = sessionId
    .toLowerCase()
    .replace(/_/g, '-u-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `builder-${encoded}`.slice(0, 64);
}

export function parseBuilderAppId(appId: string): string | null {
  if (!appId.startsWith('builder-')) return null;
  const encoded = appId.slice('builder-'.length);
  const decoded = encoded.replace(/-u-/g, '_');
  if (/^bs-[0-9a-f]{16}$/.test(decoded)) {
    return decoded.replace(/^bs-/, 'bs_');
  }
  return decoded;
}
