// 图库 = 采集到的详情图，按「商品维度」聚合：一个商品一组，附商品信息（价格/销量/收藏/链接）。
// 商品信息来自 etsy_forge_products，按 product_id join；销量/收藏来自该商品的 ehunt_json。

import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import {
  COLLECTIONS,
  type DetailImageRow,
  type EhuntMetricsJson,
  type ProductRow,
} from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LibImageOut {
  id: string;
  url: string;
  path: string | null;
  image_type: string | null;
  is_main: boolean;
  position: number;
  created_at: string;
}

interface LibProductOut {
  product_id: string;
  listing_id: string;
  keyword: string;
  title: string;
  url: string;
  price?: string;
  rating?: string;
  reviews?: string;
  sales: number | null;
  sales_recent: number | null;
  favorites: number | null;
  listed_date: string | null;
  ehunt_status?: string;
  tags: string[];
  review_count: number;
  analyzed: boolean;
  cutout_status: string;
  cutout_count: number;
  asset_status: string;
  pose_status: string;
  latest_at: string;
  images: LibImageOut[];
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const keyword = url.searchParams.get('keyword') ?? undefined;
    const productId = url.searchParams.get('product_id') ?? undefined;
    const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('limit') ?? 1000)));

    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);

    const imgFilter: Record<string, unknown> = { user_id: userId };
    if (keyword) imgFilter.keyword = keyword;
    if (productId) imgFilter.product_id = productId;
    const images = store.query<DetailImageRow>(COLLECTIONS.IMAGES, {
      filter: imgFilter,
      orderBy: { field: 'created_at', direction: 'desc' },
      limit,
    });

    // 商品信息（价格/销量/收藏/链接）来自 products 表，按 product_id 一次性建 map。
    const products = store.query<ProductRow>(COLLECTIONS.PRODUCTS, {
      filter: { user_id: userId },
      limit: 5000,
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    const groups = new Map<string, LibProductOut>();
    for (const img of images) {
      let g = groups.get(img.product_id);
      if (!g) {
        const prod = productById.get(img.product_id);
        const eh = prod?.ehunt_json ? safeParseEhunt(prod.ehunt_json) : null;
        g = {
          product_id: img.product_id,
          listing_id: prod?.listing_id ?? img.listing_id,
          keyword: prod?.keyword ?? img.keyword,
          title: prod?.title ?? '',
          url: prod?.url ?? '',
          price: prod?.price,
          rating: prod?.rating,
          reviews: prod?.reviews,
          sales: eh?.salesTotal ?? null,
          sales_recent: eh?.salesRecent ?? null,
          favorites: eh?.favorites ?? null,
          listed_date: eh?.listedDate ?? null,
          ehunt_status: prod?.ehunt_status,
          tags: Array.isArray(prod?.tags) ? prod.tags : [],
          review_count: typeof prod?.review_count === 'number' ? prod.review_count : 0,
          analyzed: Boolean(prod?.review_analyzed_at),
          cutout_status: typeof prod?.cutout_status === 'string' ? prod.cutout_status : 'idle',
          cutout_count: typeof prod?.cutout_count === 'number' ? prod.cutout_count : 0,
          asset_status: typeof prod?.asset_status === 'string' ? prod.asset_status : 'idle',
          pose_status: typeof prod?.pose_status === 'string' ? prod.pose_status : 'idle',
          latest_at: img.created_at,
          images: [],
        };
        groups.set(img.product_id, g);
      }
      g.images.push({
        id: img.id,
        url: img.image_url,
        path: img.local_path ?? null,
        image_type: img.image_type ?? null,
        is_main: img.is_main,
        position: img.position,
        created_at: img.created_at,
      });
      if (img.created_at > g.latest_at) g.latest_at = img.created_at;
    }

    // 组内图：主图优先，再按详情页顺序；组间：最近采集的商品排最前。
    const productList = Array.from(groups.values())
      .map((g) => ({
        ...g,
        images: g.images.sort((a, b) =>
          a.is_main === b.is_main ? a.position - b.position : a.is_main ? -1 : 1,
        ),
      }))
      .sort((a, b) => (a.latest_at < b.latest_at ? 1 : -1));

    // 标签词库 = 图库内所有商品标签的并集（供过滤 chip 用）。
    const allTags = Array.from(new Set(productList.flatMap((p) => p.tags))).sort();

    return NextResponse.json({
      total: images.length,
      productCount: productList.length,
      products: productList,
      allTags,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

function safeParseEhunt(s: string): EhuntMetricsJson | null {
  try {
    return JSON.parse(s) as EhuntMetricsJson;
  } catch {
    return null;
  }
}
