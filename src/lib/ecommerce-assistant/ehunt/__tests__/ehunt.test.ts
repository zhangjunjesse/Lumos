import { EcommerceLlmUnavailableError } from '../../llm-client';
import { isAdsPowerContext } from '../detector';
import { parseListingId } from '../collect';
import { computeReviewHash, analyzeReviews, type ReviewIntelCache } from '../review-analyze';
import type { EtsyReviewBundle, RawReview, ReviewIntel } from '../types';

// 只 mock generateStructured，保留真实 EcommerceLlmUnavailableError 类（instanceof 需真类）。
jest.mock('../../llm-client', () => ({
  ...jest.requireActual('../../llm-client'),
  generateStructured: jest.fn(),
}));
import { generateStructured } from '../../llm-client';
const mockGenerate = generateStructured as jest.MockedFunction<typeof generateStructured>;

function review(over: Partial<RawReview> = {}): RawReview {
  return {
    transactionId: over.transactionId ?? 't1',
    rating: over.rating ?? 5,
    date: over.date ?? 'May 1, 2026',
    text: over.text ?? 'great product',
    buyerName: over.buyerName ?? 'Amy',
    variations: over.variations ?? null,
    hasPhoto: over.hasPhoto ?? false,
    sellerResponse: over.sellerResponse ?? null,
  };
}

function bundle(over: Partial<EtsyReviewBundle> = {}): EtsyReviewBundle {
  return {
    listingId: over.listingId ?? '4409539445',
    shopId: over.shopId ?? '35957464',
    totalReviews: over.totalReviews ?? 2,
    averageRating: over.averageRating ?? 4.83,
    ratingCounts: over.ratingCounts ?? { '5': 87, '4': 13, All: 102 },
    tagFilters: over.tagFilters ?? [{ tag: 'Quality', frequency: 38 }],
    reviews: over.reviews ?? [review(), review({ transactionId: 't2', text: 'nice' })],
    pagesFetched: over.pagesFetched ?? 1,
    totalPages: over.totalPages ?? 1,
    capturedAt: over.capturedAt ?? '2026-05-16T00:00:00.000Z',
    status: over.status ?? 'ok',
    ...(over.message ? { message: over.message } : {}),
  };
}

const RAW_INTEL = {
  customer_profile: { gender_split: 'male 80% / female 20%', who: ['gift buyers'], when: ['christmas'], where: [], what: ['grilling'] },
  pros: [{ topic: 'quality', reason: 'sturdy canvas' }],
  cons: [{ topic: 'shipping', reason: 'from china, slow' }],
  expectations: [{ topic: 'gift', reason: 'for husband' }],
  motivations: [{ topic: 'personalized', reason: 'embroidered name' }],
};

describe('detector.isAdsPowerContext', () => {
  it('true only for adspower: contexts', () => {
    expect(isAdsPowerContext('adspower:k1cjt46k')).toBe(true);
    expect(isAdsPowerContext('embedded:default')).toBe(false);
    expect(isAdsPowerContext('external-cdp:abc')).toBe(false);
    expect(isAdsPowerContext('')).toBe(false);
    expect(isAdsPowerContext(null)).toBe(false);
  });
});

describe('collect.parseListingId', () => {
  it('extracts numeric id from a listing url, null otherwise', () => {
    expect(parseListingId('https://www.etsy.com/listing/4409539445/slug?ref=x')).toBe('4409539445');
    expect(parseListingId('https://www.etsy.com/c/accessories?ref=catnav-1')).toBeNull();
  });
});

describe('review-analyze.computeReviewHash', () => {
  it('is deterministic and ignores non-review fields', () => {
    const a = computeReviewHash(bundle());
    const b = computeReviewHash(bundle({ capturedAt: '2099-01-01T00:00:00.000Z', averageRating: 1 }));
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
  });
  it('changes when review content changes', () => {
    const a = computeReviewHash(bundle());
    const c = computeReviewHash(bundle({ reviews: [review({ text: 'different' })] }));
    expect(a).not.toBe(c);
  });
});

describe('review-analyze.analyzeReviews', () => {
  beforeEach(() => mockGenerate.mockReset());

  it('returns null without calling LLM when status != ok or no reviews', async () => {
    expect(await analyzeReviews(bundle({ status: 'needs_login' }))).toBeNull();
    expect(await analyzeReviews(bundle({ reviews: [] }))).toBeNull();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('returns cached intel without calling LLM on cache hit', async () => {
    const cached = { reviewHash: 'x' } as ReviewIntel;
    const cache: ReviewIntelCache = { get: jest.fn().mockResolvedValue(cached), put: jest.fn() };
    const out = await analyzeReviews(bundle(), { cache });
    expect(out).toBe(cached);
    expect(cache.get).toHaveBeenCalledWith('4409539445', expect.any(String));
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('degrades to null when LLM provider unavailable', async () => {
    mockGenerate.mockRejectedValue(new EcommerceLlmUnavailableError('no provider'));
    expect(await analyzeReviews(bundle())).toBeNull();
  });

  it('rethrows real LLM errors', async () => {
    mockGenerate.mockRejectedValue(new Error('timeout'));
    await expect(analyzeReviews(bundle())).rejects.toThrow('timeout');
  });

  it('maps schema to ReviewIntel and writes cache', async () => {
    mockGenerate.mockResolvedValue(RAW_INTEL as never);
    const put = jest.fn();
    const cache: ReviewIntelCache = { get: jest.fn().mockResolvedValue(null), put };
    const out = await analyzeReviews(bundle(), { cache });
    expect(out).not.toBeNull();
    expect(out!.customerProfile.genderSplit).toBe('male 80% / female 20%');
    expect(out!.customerProfile.who).toEqual(['gift buyers']);
    expect(out!.pros[0]).toEqual({ topic: 'quality', reason: 'sturdy canvas' });
    expect(out!.cons[0].topic).toBe('shipping');
    expect(out!.reviewHash).toBe(computeReviewHash(bundle()));
    expect(out!.model).toBe('lumos-ecommerce-review-analysis');
    expect(new Date(out!.analyzedAt).toISOString()).toBe(out!.analyzedAt);
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ listingId: '4409539445' }));
  });
});
