import type { AppManifest } from '../manifest/types';

/**
 * Permission strings stored in lumos_app_permissions.permission.
 *
 * Format (architecture doc §3.4):
 *   fs.read:<path>     | fs.write:<path>
 *   net:<domain>
 *   mcp:<server>       | mcp.tool:<server>:<tool>     (M2+)
 *   tool:<name>
 *   system:<cap>       (notification | schedule | clipboard | im-notification)
 *   data:shared        (v3+)
 */

export type PermissionLevel = 'safe' | 'moderate' | 'high';

export interface PermissionDescriptor {
  permission: string;
  level: PermissionLevel;
  /** Human-readable explanation for the consent dialog. */
  description: string;
  /** Where this came from in the manifest, for tracing back. */
  source: string;
}

/**
 * Compute the full set of permissions an app is asking for, derived purely
 * from app.json (manifest.permissions + manifest.requires).
 *
 * The installer presents this list to the user, who may grant a subset.
 * A permission omitted from the granted set is denied — no allow-by-default.
 */
export function derivePermissions(manifest: AppManifest): PermissionDescriptor[] {
  const out: PermissionDescriptor[] = [];

  // Filesystem read
  for (const p of manifest.permissions?.filesystem?.read ?? []) {
    out.push({
      permission: `fs.read:${p}`,
      level: assessFsLevel(p, 'read'),
      description: `读取本地路径：${p}`,
      source: 'permissions.filesystem.read',
    });
  }

  // Filesystem write
  for (const p of manifest.permissions?.filesystem?.write ?? []) {
    out.push({
      permission: `fs.write:${p}`,
      level: assessFsLevel(p, 'write'),
      description: `写入本地路径：${p}`,
      source: 'permissions.filesystem.write',
    });
  }

  // Network
  if (manifest.permissions?.network?.mode === 'whitelist') {
    for (const d of manifest.permissions.network.domains ?? []) {
      out.push({
        permission: `net:${d}`,
        level: 'moderate',
        description: `访问网络域名：${d}`,
        source: 'permissions.network.domains',
      });
    }
  }

  // MCP servers
  for (const s of manifest.requires?.mcp ?? []) {
    out.push({
      permission: `mcp:${s}`,
      level: 'moderate',
      description: `调用 MCP 服务器：${s}`,
      source: 'requires.mcp',
    });
  }

  // Tools
  for (const t of manifest.requires?.tools ?? []) {
    out.push({
      permission: `tool:${t}`,
      level: t === 'bash' ? 'high' : t === 'python' || t === 'file' ? 'moderate' : 'safe',
      description: describeTool(t),
      source: 'requires.tools',
    });
  }

  // System capabilities
  for (const s of manifest.permissions?.system ?? []) {
    out.push({
      permission: `system:${s}`,
      level: 'safe',
      description: describeSystem(s),
      source: 'permissions.system',
    });
  }

  // Browser
  if (manifest.requires?.browser) {
    out.push({
      permission: 'system:browser',
      level: 'high',
      description: '驱动浏览器（自动化访问网页）',
      source: 'requires.browser',
    });
  }

  // Data sharing — v1 enforces isolated; presence of 'shared' is a v3+ signal
  // but the installer's caller (validateApp) already rejected this case at
  // parse time, so we never derive it here. If it slips through, treat as
  // high-risk so the user sees it.
  if (manifest.permissions?.data === 'shared') {
    out.push({
      permission: 'data:shared',
      level: 'high',
      description: '与其他应用共享数据空间（v3+ 才支持）',
      source: 'permissions.data',
    });
  }

  return out;
}

function assessFsLevel(rawPath: string, mode: 'read' | 'write'): PermissionLevel {
  // App's own sandbox: ~/Downloads/lumos-app-{id}, lumos data dir → safe
  if (
    rawPath.includes('lumos-app-{id}') ||
    rawPath.includes('/.lumos/app-data')
  ) {
    return 'safe';
  }
  // Sensitive user dirs
  if (
    /(^|\/)(Documents|Desktop|Downloads|Library|Photos|Videos|Movies|\.ssh|\.aws|\.config)(\/|$)/.test(
      rawPath,
    )
  ) {
    return mode === 'write' ? 'high' : 'moderate';
  }
  // Generic ~ paths default to moderate
  if (rawPath.startsWith('~/')) return 'moderate';
  // Absolute system paths are high-risk
  return 'high';
}

function describeTool(t: string): string {
  switch (t) {
    case 'bash':
      return '运行 bash 命令（高风险——可访问任何本地资源）';
    case 'python':
      return '运行 Python 代码（中风险——沙箱内执行）';
    case 'file':
      return '读写本地文件（受 fs 路径白名单约束）';
    case 'web-fetch':
      return '发起网络请求（受网络白名单约束）';
    default:
      return `工具：${t}`;
  }
}

function describeSystem(s: string): string {
  switch (s) {
    case 'notification':
      return '弹出系统通知';
    case 'schedule':
      return '注册定时任务（cron）';
    case 'clipboard':
      return '读写系统剪贴板';
    case 'im-notification':
      return '向用户自己的 IM 通道发送应用通知（用户回复仍进入主 Agent）';
    default:
      return `系统能力：${s}`;
  }
}
