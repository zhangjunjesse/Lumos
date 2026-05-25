/**
 * 从闲鱼拉「我的在售商品」。通过 browser bridge 在已登录的浏览器
 * （embedded / AdsPower / CDP）里调 `mtop.idle.web.xyh.item.list`。
 *
 * 接口由 `https://www.goofish.com/personal?userId=<unb>` 页面下拉时使用，
 * 浏览器自动签名（不需要逆向 _m_h5_tk）。
 */
import {
  postToBrowserBridge,
  resolveBrowserBridgeRuntimeConfig,
  type BrowserBridgeResponse,
} from '@/lib/browser-runtime/bridge-client';

const PERSONAL_URL = 'https://www.goofish.com/personal';
const OWNER_ID = 'goofish-fetch-my-items';
const MAX_PAGES_GUARD = 20;

export interface XianyuSellerItem {
  itemId: string;
  title: string;
  price: number;
  priceText: string;
  imageUrl: string;
  itemStatus: number;
  shippingInfo: string;
  wantCount: number;
  raw?: Record<string, unknown>;
}

export interface FetchMyItemsResult {
  ok: boolean;
  items: XianyuSellerItem[];
  totalFetched: number;
  pagesFetched: number;
  message?: string;
}

interface NewPageResponse extends BrowserBridgeResponse {
  pageId?: string;
}

interface EvaluateResponse extends BrowserBridgeResponse {
  value?: unknown;
}

interface MtopListResponse {
  api?: string;
  ret?: string[];
  data?: {
    cardList?: Array<{
      cardData?: Record<string, unknown>;
      [k: string]: unknown;
    }>;
    [k: string]: unknown;
  };
}

export async function fetchMyItems(input: {
  /** 闲鱼账号 unb（用户 ID） */
  userId: string;
  /** 用哪个浏览器 context（embedded:default / adspower:xxx / external-cdp:xxx） */
  browserContextId: string;
  pageSize?: number;
  maxPages?: number;
}): Promise<FetchMyItemsResult> {
  const cfg = resolveBrowserBridgeRuntimeConfig({
    browserContextId: input.browserContextId,
    lockOwnerId: OWNER_ID,
  });
  if (!cfg) {
    return {
      ok: false, items: [], totalFetched: 0, pagesFetched: 0,
      message: `浏览器 context 不可用：${input.browserContextId}`,
    };
  }

  const pageSize = Math.max(1, Math.min(50, input.pageSize ?? 20));
  const maxPages = Math.max(1, Math.min(MAX_PAGES_GUARD, input.maxPages ?? 5));

  let pageId = '';
  try {
    const created = await postToBrowserBridge<NewPageResponse>(
      cfg,
      '/v1/pages/new',
      { background: true },
      { timeoutMs: 30_000 },
    );
    pageId = typeof created.pageId === 'string' ? created.pageId : '';
    if (!pageId) throw new Error('浏览器未返回 pageId');

    // 跳到 personal 页确保 window.lib.mtop 加载
    await postToBrowserBridge(
      cfg, '/v1/pages/navigate',
      { pageId, url: `${PERSONAL_URL}?userId=${encodeURIComponent(input.userId)}` },
      { timeoutMs: 30_000 },
    ).catch(() => undefined); // 容忍 ERR_ABORTED

    // 等 mtop 就绪
    const ready = await postToBrowserBridge<EvaluateResponse>(
      cfg, '/v1/pages/evaluate',
      {
        pageId,
        expression: `(async()=>{const s=Date.now();while(!(window.lib?.mtop?.request)&&Date.now()-s<10000){await new Promise(r=>setTimeout(r,200))};return typeof window.lib?.mtop?.request==='function'})()`,
      },
      { timeoutMs: 15_000 },
    );
    if (ready.value !== true) {
      throw new Error('浏览器里 window.lib.mtop 没就绪');
    }

    const items: XianyuSellerItem[] = [];
    let pagesFetched = 0;
    for (let p = 1; p <= maxPages; p++) {
      const resp = await postToBrowserBridge<EvaluateResponse>(
        cfg, '/v1/pages/evaluate',
        { pageId, expression: buildMtopExpression(input.userId, p, pageSize) },
        { timeoutMs: 30_000 },
      );
      pagesFetched += 1;
      const parsed = parseMtopResult(resp.value);
      if (!parsed.ok) {
        return {
          ok: false, items, totalFetched: items.length, pagesFetched,
          message: parsed.message,
        };
      }
      const batch = (parsed.cardList ?? [])
        .map((card) => normalizeCard(card.cardData ?? {}))
        .filter((it): it is XianyuSellerItem => Boolean(it?.itemId));
      items.push(...batch);
      if (batch.length < pageSize) break; // 最后一页
    }

    return { ok: true, items, totalFetched: items.length, pagesFetched };
  } catch (err) {
    return {
      ok: false, items: [], totalFetched: 0, pagesFetched: 0,
      message: err instanceof Error ? err.message : '拉取我的在售商品失败',
    };
  } finally {
    if (pageId) {
      await postToBrowserBridge(cfg, '/v1/pages/close', { pageId }, { timeoutMs: 15_000 })
        .catch(() => undefined);
    }
  }
}

function buildMtopExpression(userId: string, pageNumber: number, pageSize: number): string {
  const data = { needGroupInfo: false, pageNumber, userId, pageSize };
  return `(async()=>{try{const r=await window.lib.mtop.request({api:'mtop.idle.web.xyh.item.list',v:'1.0',data:${JSON.stringify(data)},type:'POST',dataType:'json',sessionOption:'AutoLoginOnly',ecode:0});return {ok:true,resp:r}}catch(e){return {ok:false,error:String(e?.message||e),ret:e?.ret}}})()`;
}

function parseMtopResult(value: unknown): {
  ok: boolean;
  cardList?: Array<{ cardData?: Record<string, unknown> }>;
  message?: string;
} {
  if (!value || typeof value !== 'object') {
    return { ok: false, message: '浏览器调用返回值非预期' };
  }
  const v = value as { ok?: boolean; resp?: MtopListResponse; error?: string; ret?: string[] };
  if (v.ok === false) {
    const reason = v.error || (Array.isArray(v.ret) ? v.ret.join(' | ') : '未知错误');
    return { ok: false, message: `mtop 调用失败：${reason}` };
  }
  const resp = v.resp;
  const ret = Array.isArray(resp?.ret) ? resp!.ret : [];
  if (ret.length > 0 && !ret[0].includes('SUCCESS')) {
    return { ok: false, message: `mtop 返回错误：${ret.join(' | ')}` };
  }
  return { ok: true, cardList: resp?.data?.cardList ?? [] };
}

function normalizeCard(cardData: Record<string, unknown>): XianyuSellerItem | null {
  const detail = (cardData.detailParams as Record<string, unknown> | undefined) ?? {};
  const priceInfo = (cardData.priceInfo as { price?: string; preText?: string } | undefined) ?? {};
  const picInfo = (cardData.picInfo as { picUrl?: string } | undefined) ?? {};
  const itemId = stringField(cardData.id, detail.itemId);
  if (!itemId) return null;
  const title = stringField(cardData.title, detail.title);
  const priceText = stringField(priceInfo.price, detail.soldPrice) || '0';
  const price = Number.parseFloat(priceText) || 0;
  const imageUrl = stringField(picInfo.picUrl, detail.picUrl);
  const itemStatus = typeof cardData.itemStatus === 'number' ? cardData.itemStatus : 0;
  const shippingInfo = stringField(detail.postInfo);
  const wantCount = extractWantCount(cardData);
  return {
    itemId,
    title,
    price,
    priceText,
    imageUrl,
    itemStatus,
    shippingInfo,
    wantCount,
  };
}

function extractWantCount(cardData: Record<string, unknown>): number {
  // 从 itemLabelDataVO.labelData.r3.tagList[].data.content 找形如 "4人想要" 的
  const labelDataVO = cardData.itemLabelDataVO as
    | { labelData?: { r3?: { tagList?: Array<{ data?: { content?: string } }> } } }
    | undefined;
  const tags = labelDataVO?.labelData?.r3?.tagList ?? [];
  for (const t of tags) {
    const content = t?.data?.content ?? '';
    const m = /(\d+)\s*人想要/.exec(content);
    if (m) return Number(m[1]);
  }
  return 0;
}

function stringField(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}
