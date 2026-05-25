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
    defaultVisible: false,
    icon: 'message-circle-heart',
  },
  {
    id: 'goofish-assistant',
    name: '闲鱼助手',
    description: '管理闲鱼买家会话、AI 草稿、白名单自动回复、多渠道提醒和市场搜索',
    defaultVisible: false,
    icon: 'shopping-bag',
  },
  {
    id: 'ecommerce-assistant',
    name: '电商商品助手',
    description: '一键生成电商商品图、识别商品资料，含 SOP 流程、3 方向评分、终版精修',
    defaultVisible: false,
    icon: 'sparkles',
  },
  {
    id: 'douyin-collector',
    name: '抖音采集器',
    description: '按博主或关键词采集抖音视频，抓字幕、做摘要、入知识库，长视频也能转写',
    defaultVisible: false,
    icon: 'video',
  },
  {
    id: 'deep-research',
    name: '深度调研',
    description:
      '对话驱动的端到端深度调研工作台：澄清 → 目标 → 拆解 → 风险 → 采集 → 综合 → 报告 → 自检',
    defaultVisible: false,
    icon: 'compass',
  },
  {
    id: 'etsy-erank',
    name: 'Etsy eRank 选品雷达',
    description:
      'eRank 趋势成交当种子，AI 收敛打分，配额台账与人工验证闸——不烧配额、不编数字（demo）',
    defaultVisible: false,
    icon: 'radar',
  },
  {
    id: 'pinterest-radar',
    name: 'Pinterest 选品雷达',
    description:
      'Pinterest Trends 当前 trending 词 + 90 天增长曲线 + AI 选品解读 + PDF 报告',
    defaultVisible: false,
    icon: 'pin',
  },
  {
    id: 'x-radar',
    name: 'X 雷达',
    description:
      'X (Twitter) 纯读工作台：监控雷达 / 选题挖掘 / 关注摘要 / 数据拆解 4 种任务模板共用调度与运行历史',
    defaultVisible: true,
    icon: 'radio',
  },
]);

const SETTING_KEY = 'builtin_apps_hidden';
const SERVER_SETTING_KEY = 'builtin_apps_hidden_server';
const SERVER_SYNCED_KEY = 'builtin_apps_hidden_server_synced';
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
  // Mark that we've successfully synced so the visibility helpers know to
  // trust the cached server list rather than fall back to opt-in defaults.
  setSetting(SERVER_SYNCED_KEY, '1');
  return normalized;
}

/**
 * True once the desktop has successfully pulled at least one server-side
 * visibility list. Until this is true, opt-in (defaultVisible=false) apps
 * stay hidden so a fresh install / cold start cannot accidentally reveal an
 * app the admin would have restricted.
 */
export function hasServerVisibilitySync(): boolean {
  return getSetting(SERVER_SYNCED_KEY) === '1';
}

/** Effective hidden = local user's opt-out ∪ admin's server-side hide. */
export function getEffectiveHiddenAppIds(): string[] {
  const synced = hasServerVisibilitySync();
  const localHidden = getHiddenBuiltinAppIds();
  const serverHidden = getServerHiddenAppIds();
  const merged = new Set<string>([...localHidden, ...serverHidden]);
  // Before the first server sync, opt-in apps (defaultVisible=false) stay
  // hidden by default so the user can't see something the admin would have
  // restricted just because the heartbeat hasn't fired yet.
  if (!synced) {
    for (const app of BUILTIN_APP_REGISTRY) {
      if (!app.defaultVisible) merged.add(app.id);
    }
  }
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
  /**
   * True when the app would be hidden by the opt-in default because the
   * desktop has not yet successfully synced with the server. UI uses this
   * to explain "loading admin settings…" rather than show a stale state.
   */
  hiddenByDefaultPendingSync: boolean;
}

export function getBuiltinAppVisibility(): BuiltinAppVisibilityEntry[] {
  const synced = hasServerVisibilitySync();
  const localHidden = new Set(getHiddenBuiltinAppIds());
  const serverHidden = new Set(getServerHiddenAppIds());
  return BUILTIN_APP_REGISTRY.map((app) => {
    const hiddenByUser = localHidden.has(app.id);
    const hiddenByServer = serverHidden.has(app.id);
    const hiddenByDefaultPendingSync = !synced && !app.defaultVisible;
    return {
      ...app,
      visible: !hiddenByUser && !hiddenByServer && !hiddenByDefaultPendingSync,
      hiddenByUser,
      hiddenByServer,
      hiddenByDefaultPendingSync,
    };
  });
}
