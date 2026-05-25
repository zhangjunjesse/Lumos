import { checkProductLink, type CheckLinkResult } from './goofish-link-health-checker';
import { composeListingText, type ComposeListingTextResult } from './goofish-listing-helpers';
import {
  fulfillForConversation,
  retryFulfillment,
  type FulfillResult,
} from './goofish-manual-fulfill';
import {
  cascadeDeleteProduct,
  type CascadeDeleteProductResult,
} from './goofish-product-cascade';
import {
  publishProductToAccount,
  type PublishProductResult,
} from './goofish-product-publish';
import {
  linkXianyuItemToProduct,
  syncMyItems,
  type SyncMyItemsResult,
} from './goofish-my-items-sync';
import {
  refreshXianyuItem,
  type RefreshItemResult,
} from './goofish-item-refresh';
import {
  generateProductContent,
  generateProductPreview,
  type GenerateProductContentResult,
  type GenerateProductPreviewResult,
} from './goofish-product-ai';
import type { AppManifest } from './manifest/types';
import { createAppDataStore } from './runtime/data-store';
import { getAppPlatformService } from './service';

export type GoofishProductActionResult =
  | GenerateProductContentResult
  | GenerateProductPreviewResult
  | ComposeListingTextResult
  | CheckLinkResult
  | FulfillResult
  | CascadeDeleteProductResult
  | PublishProductResult
  | SyncMyItemsResult
  | RefreshItemResult
  | { ok: false; message: string }
  | { ok: boolean; listingId?: string; message: string };

export async function handleGoofishProductAction(input: {
  manifest: AppManifest;
  appId: string;
  action: string;
  body: Record<string, unknown>;
}): Promise<GoofishProductActionResult | null> {
  const { manifest, appId, action, body } = input;

  if (action === 'generate-product-content') {
    const kind = body.kind === 'description' ? 'description' : 'title';
    return generateProductContent({
      manifest,
      kind,
      title: str(body.title),
      summary: str(body.summary),
      category: str(body.category),
      tags: Array.isArray(body.tags)
        ? body.tags.filter((t): t is string => typeof t === 'string')
        : [],
      existingDescription: str(body.existingDescription),
    });
  }

  if (action === 'generate-product-preview') {
    return generateProductPreview({
      manifest,
      title: str(body.title),
      summary: str(body.summary),
      category: str(body.category),
    });
  }

  if (action === 'compose-listing-text') {
    const svc = getAppPlatformService();
    return composeListingText({
      store: createAppDataStore(svc.db, appId),
      productId: str(body.productId),
    });
  }

  if (action === 'check-product-link') {
    return checkProductLink({
      provider: str(body.provider) || 'other',
      url: str(body.url),
    });
  }

  if (action === 'fulfill-now') {
    const svc = getAppPlatformService();
    return fulfillForConversation({
      manifest,
      store: createAppDataStore(svc.db, appId),
      conversationRowId: str(body.conversationRowId) || undefined,
      conversationId: str(body.conversationId) || undefined,
      trigger: 'manual_button',
    });
  }

  if (action === 'retry-fulfillment') {
    const logId = str(body.logId);
    if (!logId) {
      return { ok: false, message: '缺少 logId。' };
    }
    const svc = getAppPlatformService();
    return retryFulfillment({
      manifest,
      store: createAppDataStore(svc.db, appId),
      logId,
    });
  }

  if (action === 'cascade-delete-product') {
    const productId = str(body.productId);
    const svc = getAppPlatformService();
    return cascadeDeleteProduct(createAppDataStore(svc.db, appId), productId);
  }

  if (action === 'refresh-xianyu-item') {
    const svc = getAppPlatformService();
    const itemId = str(body.itemId);
    const accountUnb = str(body.accountUnb);
    if (!itemId || !accountUnb) {
      return { ok: false, message: '缺少 itemId 或 accountUnb。' };
    }
    return refreshXianyuItem({
      manifest,
      store: createAppDataStore(svc.db, appId),
      itemId,
      accountUnb,
      options: {
        rewriteDescription: body.rewriteDescription === true,
        regenerateBanner: body.regenerateBanner === true,
        overridePrice: typeof body.overridePrice === 'number' ? body.overridePrice : undefined,
        overrideTitle: str(body.overrideTitle) || undefined,
        overrideDescription: str(body.overrideDescription) || undefined,
      },
    });
  }

  if (action === 'fetch-my-items') {
    const svc = getAppPlatformService();
    const accountUnb = str(body.accountUnb);
    const browserContextId = str(body.browserContextId) || 'embedded:default';
    if (!accountUnb) {
      return { ok: false, message: '缺少 accountUnb。' };
    }
    return syncMyItems({
      manifest,
      store: createAppDataStore(svc.db, appId),
      accountUnb,
      browserContextId,
      pageSize: typeof body.pageSize === 'number' ? body.pageSize : undefined,
      maxPages: typeof body.maxPages === 'number' ? body.maxPages : undefined,
    });
  }

  if (action === 'link-xianyu-item-to-product') {
    const svc = getAppPlatformService();
    const itemId = str(body.itemId);
    const productId = str(body.productId);
    const accountUnb = str(body.accountUnb);
    const itemTitle = str(body.itemTitle);
    const price = typeof body.price === 'number' ? body.price : 0;
    if (!itemId || !productId || !accountUnb) {
      return { ok: false, message: '缺少 itemId / productId / accountUnb。' };
    }
    return linkXianyuItemToProduct({
      store: createAppDataStore(svc.db, appId),
      itemId, productId, accountUnb, itemTitle, price,
    });
  }

  if (action === 'publish-product-to-account') {
    const svc = getAppPlatformService();
    const productId = str(body.productId);
    const accountUnb = str(body.accountUnb);
    const listingId = str(body.listingId) || undefined;
    if (!productId || !accountUnb) {
      return { ok: false, message: '缺少 productId 或 accountUnb。' };
    }
    return publishProductToAccount({
      manifest,
      store: createAppDataStore(svc.db, appId),
      productId,
      accountUnb,
      listingId,
      overrides: pickPublishOverrides(body),
    });
  }

  return null;
}

function pickPublishOverrides(body: Record<string, unknown>): {
  title?: string;
  desc?: string;
  price?: number;
  originalPrice?: number;
} | undefined {
  const overrides: {
    title?: string;
    desc?: string;
    price?: number;
    originalPrice?: number;
  } = {};
  const title = str(body.title);
  if (title) overrides.title = title;
  const desc = str(body.desc);
  if (desc) overrides.desc = desc;
  if (typeof body.price === 'number' && body.price > 0) overrides.price = body.price;
  if (typeof body.originalPrice === 'number' && body.originalPrice > 0) {
    overrides.originalPrice = body.originalPrice;
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
