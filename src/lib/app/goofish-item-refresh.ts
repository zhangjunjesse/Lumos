/**
 * 「AI 优化 + 下架重发」一条龙：
 *   1. 用 AI 重写描述 + 可选 banner 重生成
 *   2. 调 goofish item delete 下架旧商品
 *   3. 调 goofish item publish 用新内容重新发布
 *   4. 同步 xianyu_items（旧条目删 + 新条目入）+ product_listings（item_id 回填）
 *
 * 闲鱼 PC 端没暴露真正的「编辑商品」接口，删除重发是卖家标准操作（同时实现
 * 「擦亮」效果，把商品送回算法推荐流头部）。
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { cookiesPathFor } from '@/lib/goofish/accounts';
import { runJsonCommand } from '@/lib/goofish/cli';
import { generateImages } from '@/lib/image';
import { getProviderModelOptions } from '@/lib/model-metadata';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { generateTextFromProvider } from '@/lib/text-generator';

import { isGoofishNativeApp } from './goofish-app-sync';
import type { AppManifest } from './manifest/types';
import type { AppDataStore } from './runtime/data-store';

const REFRESH_TMP_DIR = path.join(tmpdir(), 'lumos-goofish-refresh');

export interface RefreshItemInput {
  manifest: AppManifest;
  store: AppDataStore;
  /** 闲鱼当前的 item_id（要删的） */
  itemId: string;
  /** 哪个账号 */
  accountUnb: string;
  /** 选项：是否 AI 改描述 / 改图 banner / 改价 */
  options: {
    rewriteDescription?: boolean;
    regenerateBanner?: boolean;
    overridePrice?: number;
    overrideTitle?: string;
    overrideDescription?: string;
  };
}

export interface RefreshItemResult {
  ok: boolean;
  newItemId?: string;
  newTitle?: string;
  newDescription?: string;
  message: string;
}

interface XianyuItemRow extends Record<string, unknown> {
  item_id?: string;
  account_unb?: string;
  title?: string;
  price?: number;
  image_url?: string;
}

interface ListingRow extends Record<string, unknown> {
  product_id?: string;
  item_id?: string;
  item_title?: string;
  listed_price?: number;
}

export async function refreshXianyuItem(input: RefreshItemInput): Promise<RefreshItemResult> {
  if (!isGoofishNativeApp(input.manifest)) {
    return { ok: false, message: '当前应用不是闲鱼类应用。' };
  }
  if (!input.itemId || !input.accountUnb) {
    return { ok: false, message: '缺少 itemId 或 accountUnb。' };
  }

  // 1. 找 xianyu_items 拿当前数据作起点
  const xianyuItem = input.store.query<XianyuItemRow>('xianyu_items', {
    filter: { item_id: input.itemId }, limit: 1,
  })[0];
  if (!xianyuItem) {
    return { ok: false, message: '商品不在 Lumos 已同步列表里，请先「从闲鱼拉」一次。' };
  }

  const currentTitle = textValue(xianyuItem.title) || '未命名商品';
  const currentImage = textValue(xianyuItem.image_url);
  const currentPrice = typeof xianyuItem.price === 'number' ? xianyuItem.price : 0;

  // 2. AI 生成新内容
  const newTitle = input.options.overrideTitle?.trim() || currentTitle;
  let newDescription = input.options.overrideDescription?.trim() ?? '';
  if (!newDescription && input.options.rewriteDescription) {
    newDescription = await aiRewriteDescription(currentTitle).catch(() => '');
  }
  if (!newDescription) {
    newDescription = `「${currentTitle}」长期出，欢迎咨询。`;
  }

  const tempFiles: string[] = [];
  let imagePath = '';
  try {
    if (input.options.regenerateBanner) {
      imagePath = await aiGenerateBanner(newTitle, tempFiles).catch(() => '');
    }
    if (!imagePath && currentImage) {
      imagePath = await downloadImageToTemp(currentImage, tempFiles).catch(() => '');
    }
    if (!imagePath) {
      return { ok: false, message: '没有可用图片（原图下载失败且未启用 banner 重生成）。' };
    }

    const newPrice = input.options.overridePrice && input.options.overridePrice > 0
      ? input.options.overridePrice : currentPrice || 1;

    // 3. 下架旧商品（自动等待 goofish-cli 写操作限流）
    const cookiesPath = cookiesPathFor(input.accountUnb);
    await runCliWithRateLimitRetry(['item', 'delete', input.itemId], {
      cookiesPath,
      timeoutMs: 60_000,
    });

    // 4. 重新发布。闲鱼 client-side 写操作限流是每 60s 1 次，delete 刚消耗
    // 一次配额，publish 一定撞限流——所以预先等 65s 比让 publish 抛错再等
    // 体验好（用户至少能看到 dialog 有进度感）。
    await sleep(65_000);

    const publishArgs = [
      'item', 'publish',
      newTitle,
      newDescription,
      imagePath,
      String(newPrice),
    ];
    const publishRaw = await runCliWithRateLimitRetry(publishArgs, {
      cookiesPath,
      timeoutMs: 5 * 60_000,
    });
    const newItemId = extractItemId(publishRaw);
    if (!newItemId) {
      return {
        ok: false,
        message: '已下架旧商品但 publish 没拿到 item_id，请到「从闲鱼拉」重新同步并手动检查。',
      };
    }

    // 5. 同步 collection：xianyu_items 旧条目改 item_id、product_listings 同步
    syncCollections(input.store, {
      oldItemId: input.itemId,
      newItemId,
      newTitle,
      newPrice,
      accountUnb: input.accountUnb,
    });

    return {
      ok: true,
      newItemId,
      newTitle,
      newDescription,
      message: `已 AI 优化并重新上架，新 item_id=${newItemId}`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : '刷新失败',
    };
  } finally {
    cleanupTempFiles(tempFiles);
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 调 goofish-cli，捕获 client-side 限流错误并智能 sleep 重试一次。
 * goofish-cli 的 `acquire("item.write")` 在写操作（delete/publish）上限每 60s 1 次，
 * 触发时会抛 `RateLimitedError 限流：bucket=item.write 每 60s 上限 1, 再等 X.Xs`。
 */
async function runCliWithRateLimitRetry(
  args: string[],
  opts: { cookiesPath?: string; timeoutMs?: number },
): Promise<unknown> {
  try {
    return await runJsonCommand(args, opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const m = /再等\s*([0-9.]+)\s*s/.exec(msg);
    if (!m) throw err;
    const waitMs = Math.ceil(Number.parseFloat(m[1]) * 1000) + 2000;
    await sleep(Math.min(waitMs, 90_000));
    return runJsonCommand(args, opts);
  }
}

async function aiRewriteDescription(currentTitle: string): Promise<string> {
  const provider = resolveProviderForCapability({ moduleKey: 'chat', capability: 'text-gen' });
  if (!provider) throw new Error('未配置可用的文本生成服务商。');
  const model = getProviderModelOptions(provider)[0]?.value?.trim() || '';
  if (!model) throw new Error(`服务商"${provider.name}"没有可用模型。`);
  const system = [
    '你是闲鱼电商卖家文案专家。',
    '输出 80-150 字商品描述，含「内容亮点 + 适用人群 + 交付方式」三段。',
    '禁止"PDF/破解/盗版"等违禁词，换成"册子/参考"。直接输出纯文本，无 markdown。',
  ].join('\n');
  return generateTextFromProvider({
    providerId: provider.id,
    model,
    system,
    prompt: `请为商品「${currentTitle}」写一段吸引买家的描述。`,
    maxTokens: 500,
    temperature: 0.7,
    abortSignal: AbortSignal.timeout(120_000),
  });
}

async function aiGenerateBanner(title: string, registry: string[]): Promise<string> {
  const prompt = `Square 1:1 commercial banner cover for Chinese second-hand listing「${title}」.`
    + ' Clean modern flat design, navy blue + amber, large bold Chinese title centered,'
    + ' abstract product elements in background, professional. No people, no faces.';
  const result = await generateImages({ prompt, aspectRatio: '1:1', imageSize: '2K' });
  if (!result.images.length) throw new Error('AI 没返回 banner 图');
  registry.push(result.images[0].localPath);
  return result.images[0].localPath;
}

async function downloadImageToTemp(url: string, registry: string[]): Promise<string> {
  const httpsUrl = url.startsWith('http://') ? url.replace(/^http:/, 'https:') : url;
  const res = await fetch(httpsUrl, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`下载原图失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!existsSync(REFRESH_TMP_DIR)) mkdirSync(REFRESH_TMP_DIR, { recursive: true });
  const name = `${Date.now()}-${randomBytes(6).toString('hex')}.jpg`;
  const filePath = path.join(REFRESH_TMP_DIR, name);
  writeFileSync(filePath, buf);
  registry.push(filePath);
  return filePath;
}

function syncCollections(store: AppDataStore, p: {
  oldItemId: string;
  newItemId: string;
  newTitle: string;
  newPrice: number;
  accountUnb: string;
}): void {
  const xianyuItem = store.query<XianyuItemRow>('xianyu_items', {
    filter: { item_id: p.oldItemId }, limit: 1,
  })[0];
  if (xianyuItem) {
    store.update<XianyuItemRow>('xianyu_items', xianyuItem.id, {
      item_id: p.newItemId,
      title: p.newTitle,
      price: p.newPrice,
      last_synced_at: new Date().toISOString(),
    });
  }
  const listings = store.query<ListingRow>('product_listings', {
    filter: { item_id: p.oldItemId }, limit: 10,
  });
  for (const listing of listings) {
    store.update<ListingRow>('product_listings', listing.id, {
      item_id: p.newItemId,
      item_title: p.newTitle,
      listed_price: p.newPrice,
    });
  }
}

function cleanupTempFiles(files: string[]): void {
  for (const f of files) {
    try { unlinkSync(f); } catch { /* best effort */ }
  }
}

function extractItemId(raw: unknown): string {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const direct = pickString(r.item_id, r.itemId, r.id);
    if (direct) return direct;
    if (r.data && typeof r.data === 'object') {
      const d = r.data as Record<string, unknown>;
      return pickString(d.item_id, d.itemId, d.id) || '';
    }
  }
  return '';
}

function pickString(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

