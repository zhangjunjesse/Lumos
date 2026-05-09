import { getSetting, setSetting } from '@/lib/db';

/**
 * Per-user visibility control for built-in apps. Hides cards on `/apps`
 * without touching any underlying capability — IM tools, MCP servers,
 * browser bridge, image gen, app data store, route handlers all stay
 * exactly as they are. Only the discovery surface is gated.
 *
 * Storage:
 *   - `builtin_apps_hidden` (JSON `string[]`)            — hidden by the local user via Settings
 *   - `builtin_apps_hidden_server` (JSON `string[]`)     — hidden by the lumos-web admin (cached locally,
 *                                                          refreshed by `refreshServerHiddenAppIds()`)
 *
 * Effective visibility = `localHidden ∪ serverHidden`. Either side can
 * hide; only removing from BOTH sides reveals the card again. Unknown ids
 * in either source are silently dropped.
 */

export interface BuiltinAppDescriptor {
  id: string;
  name: string;
  description: string;
  /** Whether new installs see this app on the apps page by default. */
  defaultVisible: boolean;
  /** Lucide-style icon hint for the toggle UI. */
  icon: string;
}

export const BUILTIN_APP_REGISTRY: readonly BuiltinAppDescriptor[] = Object.freeze([
  {
    id: 'wechat-assistant',
    name: '微信助手',
    description: '本机读取微信消息，提炼今日重点、画像、待办与定时任务',
    defaultVisible: true,
    icon: 'message-circle-heart',
  },
  {
    id: 'goofish-assistant',
    name: '闲鱼助手',
    description: '管理闲鱼买家会话、AI 草稿、白名单自动回复、多渠道提醒和市场搜索',
    defaultVisible: true,
    icon: 'shopping-bag',
  },
  {
    id: 'ecommerce-assistant',
    name: '电商商品助手',
    description: '一键生成电商商品图、识别商品资料，含 SOP 流程、3 方向评分、终版精修',
    defaultVisible: true,
    icon: 'sparkles',
  },
]);

const SETTING_KEY = 'builtin_apps_hidden';
const SERVER_SETTING_KEY = 'builtin_apps_hidden_server';
const KNOWN_IDS = new Set(BUILTIN_APP_REGISTRY.map((app) => app.id));

function readJsonStringArray(key: string): string[] {
  const raw = getSetting(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string' && KNOWN_IDS.has(v));
  } catch {
    return [];
  }
}

export function listBuiltinAppDescriptors(): BuiltinAppDescriptor[] {
  return BUILTIN_APP_REGISTRY.map((app) => ({ ...app }));
}

/** Local user's own opt-out list (not the server-driven override). */
export function getHiddenBuiltinAppIds(): string[] {
  return readJsonStringArray(SETTING_KEY);
}

export function setHiddenBuiltinAppIds(ids: string[]): string[] {
  const normalized = Array.from(
    new Set(ids.filter((v) => typeof v === 'string' && KNOWN_IDS.has(v))),
  ).sort();
  setSetting(SETTING_KEY, JSON.stringify(normalized));
  return normalized;
}

/**
 * The latest snapshot of the lumos-web admin's per-user hidden list. Cached
 * locally; refreshed by `refreshServerHiddenAppIds()` from the heartbeat /
 * post-login flow. Empty when offline / never refreshed / not logged in.
 */
export function getServerHiddenAppIds(): string[] {
  return readJsonStringArray(SERVER_SETTING_KEY);
}

export function setServerHiddenAppIds(ids: string[]): string[] {
  const normalized = Array.from(
    new Set(ids.filter((v) => typeof v === 'string' && KNOWN_IDS.has(v))),
  ).sort();
  setSetting(SERVER_SETTING_KEY, JSON.stringify(normalized));
  return normalized;
}

/** Effective hidden = local user's opt-out ∪ admin's server-side hide. */
export function getEffectiveHiddenAppIds(): string[] {
  const merged = new Set<string>([...getHiddenBuiltinAppIds(), ...getServerHiddenAppIds()]);
  return Array.from(merged).sort();
}

export function isBuiltinAppVisible(id: string): boolean {
  if (!KNOWN_IDS.has(id)) return false;
  return !getEffectiveHiddenAppIds().includes(id);
}

export interface BuiltinAppVisibilityEntry extends BuiltinAppDescriptor {
  visible: boolean;
  /** Hidden by the local user (toggled in Settings). */
  hiddenByUser: boolean;
  /** Hidden by the lumos-web admin (synced from server). */
  hiddenByServer: boolean;
}

export function getBuiltinAppVisibility(): BuiltinAppVisibilityEntry[] {
  const localHidden = new Set(getHiddenBuiltinAppIds());
  const serverHidden = new Set(getServerHiddenAppIds());
  return BUILTIN_APP_REGISTRY.map((app) => {
    const hiddenByUser = localHidden.has(app.id);
    const hiddenByServer = serverHidden.has(app.id);
    return {
      ...app,
      visible: !hiddenByUser && !hiddenByServer,
      hiddenByUser,
      hiddenByServer,
    };
  });
}
