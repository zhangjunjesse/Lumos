import os from 'os';
import path from 'path';

import type Database from 'better-sqlite3';

/**
 * Permission gate — the runtime check enforced when an app tries to do
 * something side-effectful.
 *
 * Decisions are based on rows in `lumos_app_permissions`. The installer
 * inserts one row per requested permission, with `granted = 1` for those
 * the user approved at install time and `granted = 0` for those that were
 * denied or never requested. Anything not in the table is treated as denied.
 *
 * Permission strings (architecture doc §3.4):
 *   fs.read:<path>      fs.write:<path>
 *   net:<domain>
 *   mcp:<server>        mcp.tool:<server>:<tool>
 *   tool:<name>
 *   system:<cap>        system:browser
 *   data:shared
 *
 * The gate's higher-level methods (canCallMcp / canFetchUrl / canReadPath
 * etc.) translate concrete operation arguments into permission strings and
 * check them. Direct string checks are also exposed for callers that
 * already know the exact permission key.
 */

export class PermissionDeniedError extends Error {
  readonly permission: string;
  readonly appId: string;
  constructor(permission: string, appId: string) {
    super(`Permission denied for app '${appId}': ${permission}`);
    this.name = 'PermissionDeniedError';
    this.permission = permission;
    this.appId = appId;
  }
}

export interface PermissionGate {
  readonly appId: string;
  /** Return the literal granted permission strings for this app. */
  granted(): string[];
  isGranted(permission: string): boolean;
  requireOrThrow(permission: string): void;

  canCallMcp(server: string): boolean;
  canCallMcpTool(server: string, tool: string): boolean;
  canUseTool(name: string): boolean;
  canFetchUrl(url: string): boolean;
  canReadPath(absolutePath: string): boolean;
  canWritePath(absolutePath: string): boolean;
  canUseSystem(cap: 'notification' | 'schedule' | 'clipboard' | 'browser'): boolean;
}

export interface PermissionGateOptions {
  /** Override HOME for testing fs path resolution. */
  homeDir?: string;
}

const APP_ID_RE = /^[a-z][a-z0-9-]{2,63}$/;

export function createPermissionGate(
  db: Database.Database,
  appId: string,
  opts: PermissionGateOptions = {},
): PermissionGate {
  if (!APP_ID_RE.test(appId)) {
    throw new Error(
      `Invalid appId: ${JSON.stringify(appId)} (must match /^[a-z][a-z0-9-]{2,63}$/)`,
    );
  }
  const home = opts.homeDir ?? os.homedir();

  // Materialize the granted set on construction. The PermissionGate is
  // intentionally a snapshot — install/uninstall/permission-update flows
  // must rebuild the gate.
  const grantedSet = loadGranted(db, appId);

  function isGranted(permission: string): boolean {
    return grantedSet.has(permission);
  }

  function requireOrThrow(permission: string): void {
    if (!isGranted(permission)) {
      throw new PermissionDeniedError(permission, appId);
    }
  }

  function canCallMcp(server: string): boolean {
    return isGranted(`mcp:${server}`);
  }
  function canCallMcpTool(server: string, tool: string): boolean {
    if (isGranted(`mcp.tool:${server}:${tool}`)) return true;
    return isGranted(`mcp:${server}`);
  }
  function canUseTool(name: string): boolean {
    return isGranted(`tool:${name}`);
  }
  function canUseSystem(cap: 'notification' | 'schedule' | 'clipboard' | 'browser'): boolean {
    return isGranted(`system:${cap}`);
  }

  function canFetchUrl(url: string): boolean {
    let host: string;
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      host = u.hostname.toLowerCase();
    } catch {
      return false;
    }
    return isGranted(`net:${host}`);
  }

  function canReadPath(absolutePath: string): boolean {
    return matchesFsPrefix(grantedSet, 'fs.read', absolutePath, home);
  }
  function canWritePath(absolutePath: string): boolean {
    return matchesFsPrefix(grantedSet, 'fs.write', absolutePath, home);
  }

  return {
    appId,
    granted: () => Array.from(grantedSet),
    isGranted,
    requireOrThrow,
    canCallMcp,
    canCallMcpTool,
    canUseTool,
    canFetchUrl,
    canReadPath,
    canWritePath,
    canUseSystem,
  };
}

// ---- helpers ----

function loadGranted(db: Database.Database, appId: string): Set<string> {
  const rows = db
    .prepare(
      `SELECT permission FROM lumos_app_permissions
       WHERE app_id = ? AND granted = 1`,
    )
    .all(appId) as { permission: string }[];
  return new Set(rows.map((r) => r.permission));
}

/**
 * Check whether `target` lies inside any granted fs prefix.
 *
 * Stored fs.read / fs.write permission strings look like:
 *   "fs.read:~/Documents/customers"
 *   "fs.write:~/Downloads/lumos-app-{id}"
 *   "fs.write:/Users/foo/projects"
 *
 * Both the granted prefix and the target are resolved to absolute paths
 * (with `~` expanded against `homeDir`) before comparison. We require a
 * proper directory boundary on the prefix match so that
 * "fs.read:~/Documents/foo" does NOT grant "/Users/x/Documents/foo-bar".
 */
function matchesFsPrefix(
  granted: Set<string>,
  kind: 'fs.read' | 'fs.write',
  targetPath: string,
  homeDir: string,
): boolean {
  const targetAbs = resolvePath(targetPath, homeDir);
  for (const perm of granted) {
    if (!perm.startsWith(`${kind}:`)) continue;
    const rawPrefix = perm.slice(kind.length + 1);
    const prefixAbs = resolvePath(rawPrefix, homeDir);
    if (targetAbs === prefixAbs) return true;
    if (targetAbs.startsWith(prefixAbs + path.sep)) return true;
  }
  return false;
}

function resolvePath(p: string, homeDir: string): string {
  let resolved = p;
  if (resolved === '~') resolved = homeDir;
  else if (resolved.startsWith('~/')) resolved = path.join(homeDir, resolved.slice(2));
  return path.normalize(path.resolve(resolved));
}
