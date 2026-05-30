// AdsPower CDP 端口探测 + Lumos browser context 解析 —— 选品/抓取应用共享
//
// Lumos 平台级浏览器管理:用户在「设置 → 浏览器服务商」里配的 AdsPower profile
// 都暴露成 browser context id(形如 'adspower:k1ck97si')。各内置应用收到
// context id 后,统一通过 startAdsPowerForContext() 拿 CDP handle,
// 不要绕过这层直接调 AdsPower API。
//
// 规则(SOP §5.1):
//   - 不调 AdsPower stop;profile 已启动直接复用,未启动才 start
//   - 不缓存 port;AdsPower 每次重启会变,每次抓前 fetch 一次

import { chromium, type Browser } from 'playwright';

const ADSPOWER_API = process.env.ADSPOWER_API_BASE ?? 'http://127.0.0.1:50325';
const DEFAULT_PROFILE = process.env.ADSPOWER_PROFILE_ID ?? 'k1ck97si';

export interface AdsPowerHandle {
  profileId: string;
  debugPort: string;
  wsEndpoint: string;
}

interface AdsPowerStartResp {
  code: number;
  data?: { debug_port?: string; ws?: { selenium?: string; puppeteer?: string } };
  msg?: string;
}

export async function startAdsPower(profileId: string = DEFAULT_PROFILE): Promise<AdsPowerHandle> {
  const url = `${ADSPOWER_API}/api/v1/browser/start?user_id=${encodeURIComponent(profileId)}`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`AdsPower 桌面端没在跑(${ADSPOWER_API} 连不上 — ${reason})。请先打开 AdsPower。`);
  }
  if (!res.ok) {
    throw new Error(`AdsPower API HTTP ${res.status}(${ADSPOWER_API})— 检查 AdsPower 桌面端是否打开`);
  }
  const json = (await res.json()) as AdsPowerStartResp;
  if (json.code !== 0 || !json.data?.debug_port) {
    const msg = json.msg ?? '未知错误';
    if (/not found|不存在/i.test(msg)) {
      throw new Error(`AdsPower 找不到 profile「${profileId}」。在 AdsPower 检查 profile id,或通过 env ADSPOWER_PROFILE_ID 改默认值。`);
    }
    throw new Error(`AdsPower 启动失败: ${msg}(profile ${profileId})`);
  }
  const debugPort = json.data.debug_port;
  return {
    profileId,
    debugPort,
    wsEndpoint: `http://127.0.0.1:${debugPort}`,
  };
}

export interface AdsPowerStatus {
  available: boolean;
  profileId: string;
  apiBase: string;
  debugPort?: string;
  error?: string;
}

export async function probeAdsPower(profileId: string = DEFAULT_PROFILE): Promise<AdsPowerStatus> {
  try {
    const handle = await startAdsPower(profileId);
    return { available: true, profileId, apiBase: ADSPOWER_API, debugPort: handle.debugPort };
  } catch (err) {
    return { available: false, profileId, apiBase: ADSPOWER_API, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 根据 Lumos browser context id 解析出 AdsPower profile id。
 * 形如 'adspower:k1ck97si' → 'k1ck97si'。
 * 留空 / 'embedded:default' → 返回 DEFAULT_PROFILE(env 默认)。
 * 其他 provider type → 抛错(目前选品/抓取只支持 AdsPower 登录态)。
 */
export function resolveAdsPowerProfileFromContext(browserContextId?: string | null): string {
  const id = browserContextId?.trim();
  if (!id || id === 'embedded:default') return DEFAULT_PROFILE;
  const colon = id.indexOf(':');
  if (colon < 0) return DEFAULT_PROFILE;
  const providerType = id.slice(0, colon);
  const profileId = id.slice(colon + 1).trim();
  if (providerType !== 'adspower') {
    throw new Error(
      `抓取目前只支持 AdsPower 浏览器(当前选择:${providerType})。请在「新开一轮」里选 AdsPower profile,或留空走默认。`,
    );
  }
  if (!profileId) {
    throw new Error(`AdsPower profile id 为空(browser_context_id=${id})`);
  }
  return profileId;
}

/** 通过 Lumos browser context id 启动 AdsPower。 */
export async function startAdsPowerForContext(browserContextId?: string | null): Promise<AdsPowerHandle> {
  return startAdsPower(resolveAdsPowerProfileFromContext(browserContextId));
}

/**
 * 用 Playwright 连 AdsPower CDP。Playwright 连接时要 attach 浏览器里**所有**标签页/worker,
 * 页一多(尤其重型内容页 + 广告追踪 iframe)attach 会卡死直至超时。
 * 失败时查当前网页标签数,抛出可操作的中文提示(让用户手动关多余标签),不擅自关用户的页。
 * 超时设 20s:正常连接(页少)仅百毫秒级,卡死则远超,足够区分且不让用户干等满 30s。
 */
export async function connectBrowserOverCDP(
  handle: AdsPowerHandle,
  timeoutMs = 20_000,
): Promise<Browser> {
  try {
    return await chromium.connectOverCDP(handle.wsEndpoint, { timeout: timeoutMs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/timeout/i.test(msg)) throw err;
    const pages = await countOpenHttpPages(handle).catch(() => null);
    const where = pages != null ? `当前开了 ${pages} 个网页标签` : '标签页可能过多';
    throw new Error(
      `连接采集浏览器超时（${where}）。连接时需要接管浏览器里所有标签页，页一多就会卡死。` +
        `请在该浏览器里手动关掉多余的标签页（只留一个空白页）后，再重试采集。`,
    );
  }
}

/** 原生 CDP 查当前打开的 http(s) 网页标签数(用于连接超时时的诊断提示)。 */
async function countOpenHttpPages(handle: AdsPowerHandle): Promise<number> {
  const res = await fetch(`${handle.wsEndpoint}/json`, { signal: AbortSignal.timeout(5_000) });
  const targets = (await res.json()) as Array<{ type?: string; url?: string }>;
  return targets.filter((t) => t.type === 'page' && /^https?:/i.test(t.url ?? '')).length;
}
