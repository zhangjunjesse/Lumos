import { createHash } from 'node:crypto';

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import type { ReviewIntel } from './types';
import type { ReviewIntelCache } from './review-analyze';

/**
 * `ReviewIntelCache` 的 AppDataStore 持久化实现（review-analyze.ts §5.3 遗留的集成层绑定）。
 *
 * 键 = sha256(listingId:reviewHash)，作记录 id：评论内容未变 → hash 不变 → 命中，不重复调 LLM。
 * 评论变化产生新 hash → 新记录，旧记录自然失效（保留历史，不做删除）。
 */

const COLLECTION = 'ehunt_review_intel';

interface ReviewIntelRecord extends Record<string, unknown> {
  listing_id: string;
  review_hash: string;
  intel_json: string;
  created_at: string;
}

function cacheId(listingId: string, reviewHash: string): string {
  return createHash('sha256').update(`${listingId}:${reviewHash}`).digest('hex');
}

export function createReviewIntelCache(store: AppDataStore): ReviewIntelCache {
  return {
    get(listingId: string, reviewHash: string): ReviewIntel | null {
      const row = store.get<ReviewIntelRecord>(COLLECTION, cacheId(listingId, reviewHash));
      if (!row || row.review_hash !== reviewHash) return null;
      try {
        return JSON.parse(row.intel_json) as ReviewIntel;
      } catch {
        return null;
      }
    },
    put(intel: ReviewIntel & { listingId: string }): void {
      const id = cacheId(intel.listingId, intel.reviewHash);
      const record: ReviewIntelRecord & { id: string } = {
        id,
        listing_id: intel.listingId,
        review_hash: intel.reviewHash,
        intel_json: JSON.stringify(intel),
        created_at: new Date().toISOString(),
      };
      if (store.get(COLLECTION, id)) {
        store.update<ReviewIntelRecord>(COLLECTION, id, record);
      } else {
        store.create<ReviewIntelRecord>(COLLECTION, record);
      }
    },
  };
}
