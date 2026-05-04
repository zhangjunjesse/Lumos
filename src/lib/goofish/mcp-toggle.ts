/**
 * Toggle the built-in `goofish` MCP server's enabled state in lumos.db.
 *
 * goofish ships disabled by default (init-builtin-resources.ts intentionally
 * does NOT add it to the auto-enable list) because the MCP requires a
 * logged-in account; enabling without cookies pollutes every Agent context
 * with auth errors. The auth API routes flip this flag based on cookie state.
 */

import { getMcpServerByNameAndScope, toggleMcpServerEnabled } from '@/lib/db/mcp-servers';

const PRIMARY = 'goofish';
const ALWAYS_ON = 'goofish-search';

export function getGoofishMcpEnabled(): boolean | null {
  const record = getMcpServerByNameAndScope(PRIMARY, 'builtin');
  if (!record) return null;
  return Boolean(record.is_enabled);
}

/**
 * Flip the live-mtop `goofish` MCP only. The companion `goofish-search` MCP
 * just reads the local archive and is harmless without a login, so we keep
 * it always-on (default-enabled in init-builtin-resources). Logging in/out
 * just toggles the live tools.
 */
export function setGoofishMcpEnabled(enabled: boolean): boolean {
  // Belt-and-suspenders: ensure goofish-search is on every time we touch the
  // pair, in case something disabled it manually.
  const search = getMcpServerByNameAndScope(ALWAYS_ON, 'builtin');
  if (search && !search.is_enabled) toggleMcpServerEnabled(search.id, true);

  const record = getMcpServerByNameAndScope(PRIMARY, 'builtin');
  if (!record) return false;
  if (Boolean(record.is_enabled) === enabled) return true;
  return toggleMcpServerEnabled(record.id, enabled);
}
