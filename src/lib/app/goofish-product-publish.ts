/**
 * 一键发布商品到闲鱼。调 goofish-cli `item publish` 真正在闲鱼挂商品，拿到
 * item_id 后回写到 product_listings collection。
 *
 * 失败场景（任一发生即返回 ok=false）：
 *   - 账号未授权 / cookies 失效（让用户去概况页重登）
 *   - 商品图片解码失败 / 临时文件写不进去
 *   - goofish-cli 风控拦截（FAIL_BIZ_xxx）
 *   - 返回数据缺少 item_id（兜底）
 *
 * 不抛任何异常 —— 错误统一用 result.message 暴露给前端。
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { cookiesPathFor } from '@/lib/goofish/accounts';
import { runJsonCommand } from '@/lib/goofish/cli';

import { isGoofishNativeApp } from './goofish-app-sync';
import type { AppManifest } from './manifest/types';
import type { AppDataStore } from './runtime/data-store';

const PUBLISH_TMP_DIR = path.join(tmpdir(), 'lumos-goofish-publish');

export type PublishStatus = 'success' | 'failed';

export interface PublishProductInput {
  manifest: AppManifest;
  store: AppDataStore;
  productId: string;
  accountUnb: string;
  /**
   * Optional. If given, the resulting listing row will reuse this id (we just
   * fill in item_id + item_title once publish succeeds). Otherwise a new
   * listing row is created.
   */
  listingId?: string;
  /** Overrides — fallback to product fields when omitted. */
  overrides?: {
    title?: string;
    desc?: string;
    price?: number;
    originalPrice?: number;
  };
}

export interface PublishProductResult {
  ok: boolean;
  status: PublishStatus;
  itemId?: string;
  itemUrl?: string;
  listingId?: string;
  message: string;
}

interface ProductRow extends Record<string, unknown> {
  title?: string;
  summary?: string;
  ai_generated_description?: string;
  suggested_price?: number;
  preview_image_paths?: string[];
}

interface ListingRow extends Record<string, unknown> {
  product_id?: string;
  account_unb?: string;
  account_label?: string;
  item_id?: string;
  item_title?: string;
  listed_price?: number;
  listed_at?: string;
  status?: string;
  publish_status?: 'never' | 'pending' | 'success' | 'failed';
  last_publish_error?: string;
  last_publish_at?: string;
}

export async function publishProductToAccount(
  input: PublishProductInput,
): Promise<PublishProductResult> {
  if (!isGoofishNativeApp(input.manifest)) {
    return fail('当前应用不是闲鱼类应用。');
  }
  const product = input.store.get<ProductRow>('products', input.productId);
  if (!product) {
    return fail('找不到要发布的商品。');
  }

  const title = (input.overrides?.title ?? product.title ?? '').trim();
  const description = (
    input.overrides?.desc
    ?? product.summary
    ?? product.ai_generated_description
    ?? ''
  ).trim();
  const price = input.overrides?.price ?? product.suggested_price ?? 0;
  if (!title) return fail('请先填好商品标题再发布。');
  if (!description) return fail('请先填好商品描述再发布。');
  if (!price || price <= 0) return fail('请填写大于 0 的价格再发布。');

  const images = Array.isArray(product.preview_image_paths)
    ? product.preview_image_paths.filter((p) => typeof p === 'string' && p.length > 0)
    : [];
  if (images.length === 0) {
    return fail('请上传至少 1 张预览图再发布（闲鱼上架要求图片）。');
  }

  const tempFiles: string[] = [];
  try {
    const filePaths = await materializeImages(images, tempFiles);
    const cookiesPath = cookiesPathFor(input.accountUnb);

    const cliArgs = [
      'item', 'publish',
      title,
      description,
      ...filePaths,
      String(price),
    ];
    if (input.overrides?.originalPrice && input.overrides.originalPrice > 0) {
      cliArgs.push('--original-price', String(input.overrides.originalPrice));
    }

    const raw = await runJsonCommand(cliArgs, {
      cookiesPath,
      timeoutMs: 5 * 60_000,
    });
    const parsed = parsePublishResponse(raw);
    if (!parsed.itemId) {
      return fail(parsed.message || 'goofish-cli 返回未识别格式，无法定位 item_id。');
    }

    const now = new Date().toISOString();
    const itemTitle = parsed.itemTitle || title;
    let listingId = input.listingId ?? '';
    if (listingId && input.store.get('product_listings', listingId)) {
      input.store.update<ListingRow>('product_listings', listingId, {
        item_id: parsed.itemId,
        item_title: itemTitle,
        listed_price: price,
        status: 'live',
        listed_at: now,
        publish_status: 'success',
        last_publish_error: '',
        last_publish_at: now,
      });
    } else {
      const created = input.store.create<ListingRow>('product_listings', {
        product_id: input.productId,
        account_unb: input.accountUnb,
        account_label: input.accountUnb,
        item_id: parsed.itemId,
        item_title: itemTitle,
        listed_price: price,
        status: 'live',
        listed_at: now,
        publish_status: 'success',
        last_publish_at: now,
      });
      listingId = created.id;
    }

    return {
      ok: true,
      status: 'success',
      itemId: parsed.itemId,
      itemUrl: parsed.itemUrl,
      listingId,
      message: `已发到闲鱼，item_id=${parsed.itemId}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : '发布失败';
    // 失败时把状态写到 listing（如果有 listingId）
    if (input.listingId && input.store.get('product_listings', input.listingId)) {
      input.store.update<ListingRow>('product_listings', input.listingId, {
        publish_status: 'failed',
        last_publish_error: message,
        last_publish_at: new Date().toISOString(),
      });
    }
    return { ok: false, status: 'failed', message };
  } finally {
    cleanupTempFiles(tempFiles);
  }
}

function fail(message: string): PublishProductResult {
  return { ok: false, status: 'failed', message };
}

async function materializeImages(images: string[], registry: string[]): Promise<string[]> {
  if (!existsSync(PUBLISH_TMP_DIR)) {
    mkdirSync(PUBLISH_TMP_DIR, { recursive: true });
  }
  const out: string[] = [];
  for (const [idx, src] of images.entries()) {
    if (src.startsWith('data:')) {
      const filePath = writeDataUrlToFile(src, idx);
      registry.push(filePath);
      out.push(filePath);
    } else if (path.isAbsolute(src) && existsSync(src)) {
      out.push(src);
    } else {
      throw new Error(`图片 #${idx + 1} 既不是 dataURL 也不是有效本地路径：${src.slice(0, 60)}`);
    }
  }
  return out;
}

function writeDataUrlToFile(dataUrl: string, idx: number): string {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error(`图片 #${idx + 1} 的 dataURL 格式不识别`);
  }
  const mime = match[1];
  const base64 = match[2];
  const ext = mime === 'image/png' ? '.png'
    : mime === 'image/webp' ? '.webp'
      : mime === 'image/gif' ? '.gif'
        : '.jpg';
  const name = `${Date.now()}-${randomBytes(6).toString('hex')}-${idx}${ext}`;
  const filePath = path.join(PUBLISH_TMP_DIR, name);
  writeFileSync(filePath, Buffer.from(base64, 'base64'));
  return filePath;
}

function cleanupTempFiles(files: string[]): void {
  for (const f of files) {
    try { unlinkSync(f); } catch { /* best effort */ }
  }
}

function parsePublishResponse(raw: unknown): {
  itemId?: string;
  itemUrl?: string;
  itemTitle?: string;
  message?: string;
} {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const itemId = pickString(r.itemId, r.item_id, r.id);
    const itemUrl = pickString(r.itemUrl, r.item_url, r.url);
    const itemTitle = pickString(r.itemTitle, r.item_title, r.title);
    if (itemId) return { itemId, itemUrl, itemTitle };
    const data = r.data;
    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>;
      const did = pickString(d.itemId, d.item_id, d.id);
      if (did) {
        return {
          itemId: did,
          itemUrl: pickString(d.itemUrl, d.item_url, d.url),
          itemTitle: pickString(d.itemTitle, d.item_title, d.title),
        };
      }
    }
    const message = pickString(r.message, r.msg, r.error);
    if (message) return { message };
  }
  return {};
}

function pickString(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return undefined;
}
