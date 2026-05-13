import type { AppDataStore, AppRow } from '@/lib/app/runtime/data-store';
import type {
  ListingDraftRecord,
  ListingFollowupRecord,
  ListingFollowupTemplateId,
} from './types';

export type ListingFollowupRow = AppRow<ListingFollowupRecord>;

interface FollowupTemplate {
  id: ListingFollowupTemplateId;
  /** offset in days from go-live */
  offsetDays: number;
  title: string;
  description: string;
  /** if set, only seed for these platforms; undefined = all platforms */
  platforms?: string[];
}

const TEMPLATES: FollowupTemplate[] = [
  {
    id: 'check-first-order',
    offsetDays: 1,
    title: 'D+1：检查首单',
    description:
      '上线 24h 内：是否有首单？如无，检查 listing 是否被压制 / 价格异常 / 类目错放。',
  },
  {
    id: 'set-ad-budget',
    offsetDays: 1,
    title: 'D+1：设置 PPC 广告预算',
    description:
      '黄金 90 天内 PPC 是关键引流。建议先开 Auto + 1 个 Manual exact bid，预算 $5-15/日。',
    platforms: ['amazon-us', 'amazon-uk', 'amazon-jp', 'amazon-de', 'walmart'],
  },
  {
    id: 'check-search-rank',
    offsetDays: 3,
    title: 'D+3：核对主关键词搜索排名',
    description:
      '在目标平台搜索主关键词，看自己的 listing 在第几页。低于第 3 页要补关键词 + 改主图 CTR。',
  },
  {
    id: 'check-first-review',
    offsetDays: 7,
    title: 'D+7：检查首条评价',
    description:
      '是否已有评价？如有差评 → 在合规清单复用中分析痛点 + 反馈给工厂。无评价 → 考虑 Vine / 索评邮件。',
  },
  {
    id: 'check-conversion-rate',
    offsetDays: 7,
    title: 'D+7：检查转化率',
    description:
      '查看曝光 → 点击 → 下单的漏斗。CR < 5%（Amazon）/ < 2%（TikTok Shop）需要优化主图 / 标题 / 价。',
  },
  {
    id: 'check-bsr-week',
    offsetDays: 7,
    title: 'D+7：检查类目 BSR / 排行',
    description:
      '截图当前 BSR / TikTok Shop 类目排名。建立基准，往后对照看广告 / 评价 / 改 listing 的影响。',
    platforms: ['amazon-us', 'amazon-uk', 'amazon-jp', 'amazon-de', 'tiktok-shop-us', 'walmart'],
  },
  {
    id: 'review-week-summary',
    offsetDays: 7,
    title: 'D+7：本周复盘',
    description:
      '汇总：订单数 / 广告花费 / ACoS / 评价 / 退货。决定下周是放量、调价、改广告还是改 listing。',
  },
];

export function listFollowups(
  store: AppDataStore,
  filter?: { draft_id?: string; input_id?: string; status?: string },
): ListingFollowupRow[] {
  return store.query<ListingFollowupRecord>('listing_followups', {
    filter: filter as Record<string, unknown> | undefined,
    orderBy: { field: 'due_at', direction: 'asc' },
    limit: 200,
  });
}

/**
 * Seed the standard follow-up checklist for a listing that just transitioned
 * to status='live'. Idempotent: if any followups already exist for this
 * draft, this is a no-op (re-marking live → re-marking live shouldn't
 * duplicate todos, and the user may have already started checking them off).
 */
export function seedFollowupsForListing(
  store: AppDataStore,
  draft: ListingDraftRecord & { id: string },
  goLiveAt: Date = new Date(),
): { created: number } {
  const existing = listFollowups(store, { draft_id: draft.id });
  if (existing.length > 0) return { created: 0 };

  let created = 0;
  for (const tmpl of TEMPLATES) {
    if (tmpl.platforms && !tmpl.platforms.includes(draft.platform)) continue;
    const due = new Date(goLiveAt.getTime() + tmpl.offsetDays * 24 * 60 * 60 * 1000);
    const now = new Date().toISOString();
    store.create<ListingFollowupRecord>('listing_followups', {
      draft_id: draft.id,
      input_id: draft.input_id,
      template_id: tmpl.id,
      title: tmpl.title,
      description: tmpl.description,
      due_at: due.toISOString(),
      status: 'pending',
      created_at: now,
    });
    created++;
  }
  return { created };
}
