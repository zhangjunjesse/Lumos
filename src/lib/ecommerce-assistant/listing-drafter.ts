import { z } from 'zod';
import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { generateStructured, EcommerceLlmUnavailableError } from './llm-client';
import {
  createListingDraft,
  setListingDraftStatus,
  type ListingDraftRow,
} from './storage';
import type {
  ListingPlatform,
  ProductBriefRecord,
  ProductInputRecord,
} from './types';

export class ListingDrafterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ListingDrafterError';
  }
}

export interface DraftListingInput {
  inputId: string;
  platform: ListingPlatform;
  language: string; // BCP-47 e.g. 'en', 'zh', 'ja'
  count?: number; // bullets count, default 5
}

export interface DraftListingOutcome {
  draft: ListingDraftRow;
}

const draftSchema = z.object({
  title: z.string().min(1).describe('SEO-optimized listing title within platform limits'),
  bullets: z
    .array(z.string().min(1))
    .min(3)
    .max(10)
    .describe('benefit-led bullet points; each ≤200 chars'),
  description: z
    .string()
    .min(1)
    .describe('paragraph description, optionally markdown for Shopify/Etsy'),
  search_keywords: z
    .array(z.string().min(1))
    .max(50)
    .default([])
    .describe('backend search keywords (Amazon-style); space-separated tokens, no duplicates with title'),
  warnings: z
    .array(z.string())
    .default([])
    .describe('compliance / claim warnings the seller must review'),
});

export async function draftListingForInput(
  store: AppDataStore,
  args: DraftListingInput,
  abortSignal?: AbortSignal,
): Promise<DraftListingOutcome> {
  const input = store.get<ProductInputRecord>('product_inputs', args.inputId);
  if (!input) {
    throw new ListingDrafterError(`商品输入不存在：${args.inputId}`);
  }
  const briefRow = store
    .query<ProductBriefRecord>('product_briefs', {
      filter: { input_id: args.inputId },
      limit: 1,
    })
    .at(0);

  const draft = createListingDraft(store, {
    input_id: args.inputId,
    platform: args.platform,
    language: args.language,
    status: 'drafting',
  });

  try {
    const data = await generateStructured({
      schema: draftSchema,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt({
        platform: args.platform,
        language: args.language,
        count: args.count ?? 5,
        input,
        brief: briefRow ?? null,
      }),
      abortSignal,
      maxTokens: 4096,
    });
    setListingDraftStatus(store, draft.id, 'ready', {
      title: data.title,
      bullets: JSON.stringify(data.bullets),
      description: data.description,
      search_keywords: JSON.stringify(data.search_keywords),
      warnings: JSON.stringify(data.warnings),
    });
    const updated = store.get('listing_drafts', draft.id) as ListingDraftRow;
    return { draft: updated };
  } catch (err) {
    setListingDraftStatus(store, draft.id, 'failed', {
      failure_reason: err instanceof Error ? err.message : String(err),
    });
    if (err instanceof EcommerceLlmUnavailableError) throw err;
    throw new ListingDrafterError(err instanceof Error ? err.message : String(err));
  }
}

interface BuildPromptArgs {
  platform: ListingPlatform;
  language: string;
  count: number;
  input: ProductInputRecord;
  brief: ProductBriefRecord | null;
}

function buildPrompt(args: BuildPromptArgs): string {
  const cap = PLATFORM_CAPS[args.platform] ?? GENERIC_CAPS;
  const briefBlock = args.brief
    ? [
        `Product type: ${args.brief.product_type ?? 'unknown'}`,
        `Category bucket: ${args.brief.category_bucket ?? 'unknown'}`,
        `Selling points (parsed JSON): ${args.brief.core_selling_points ?? '[]'}`,
        `Target audience: ${args.brief.target_audience ?? '[]'}`,
        `Avoid elements: ${args.brief.avoid_elements ?? '[]'}`,
      ].join('\n')
    : 'No identified brief yet — base your draft on the input title and note only.';

  return [
    `Draft a marketplace listing for "${args.input.title}".`,
    `Target platform: ${args.platform}`,
    `Output language: ${args.language}`,
    '',
    'Platform constraints:',
    `- Title: max ${cap.titleMax} chars. Lead with main keyword + key spec + brand placeholder.`,
    `- Bullets: ${args.count} bullets, each ≤ ${cap.bulletMax} chars. Each bullet leads with a benefit then explains.`,
    `- Description: ${cap.descGuide}`,
    `- Search keywords: ${cap.keywordsGuide}`,
    '',
    'Product brief:',
    briefBlock,
    args.input.note ? `\nUser notes:\n${args.input.note}` : '',
    args.input.category_hint ? `\nCategory hint: ${args.input.category_hint}` : '',
    '',
    'Hard rules:',
    '- Do NOT fabricate certifications (FDA, CE, FCC, BPA-free, etc) unless the brief mentions them.',
    '- Do NOT make medical / health / weight-loss claims.',
    '- Do NOT use competitor brand names.',
    '- If you have to soften a claim due to compliance, mention it in the warnings array.',
    '- Output strict JSON matching the schema. No commentary outside JSON.',
  ]
    .filter(Boolean)
    .join('\n');
}

interface PlatformCap {
  titleMax: number;
  bulletMax: number;
  descGuide: string;
  keywordsGuide: string;
}

const GENERIC_CAPS: PlatformCap = {
  titleMax: 200,
  bulletMax: 250,
  descGuide: '2-4 paragraphs, scannable.',
  keywordsGuide: 'up to 30 lowercase tokens, no duplicates with title.',
};

const PLATFORM_CAPS: Record<ListingPlatform, PlatformCap> = {
  'amazon-us': {
    titleMax: 200,
    bulletMax: 250,
    descGuide: '2 paragraphs of plain text. No HTML.',
    keywordsGuide: 'Backend search keywords: ≤249 bytes, lowercase, space-separated, no commas, no duplicates with title.',
  },
  'amazon-uk': {
    titleMax: 200,
    bulletMax: 250,
    descGuide: '2 paragraphs of plain text. No HTML. Use UK English (colour, organise).',
    keywordsGuide: 'Backend search keywords: ≤249 bytes, lowercase UK English, space-separated.',
  },
  'amazon-jp': {
    titleMax: 50,
    bulletMax: 200,
    descGuide: '日本語で 2-3 段落、敬語ではなく自然な商品説明。',
    keywordsGuide: '半角スペース区切り、全角不可、商品名と重複しない。',
  },
  'amazon-de': {
    titleMax: 200,
    bulletMax: 250,
    descGuide: '2 Absätze auf Deutsch. Sie-Form. Kein HTML.',
    keywordsGuide: 'Backend-Suchbegriffe: kleinbuchstaben, mit Leerzeichen getrennt.',
  },
  'tiktok-shop-us': {
    titleMax: 60,
    bulletMax: 120,
    descGuide: '4-6 short paragraphs, hook-first, conversational tone matching short-video pace.',
    keywordsGuide: 'TikTok hashtags style, lowercase, max 15.',
  },
  'etsy': {
    titleMax: 140,
    bulletMax: 200,
    descGuide: 'Storytelling tone, 3-5 paragraphs, mention occasion / gift use.',
    keywordsGuide: 'Etsy tags: 13 max, each ≤20 chars, multi-word allowed.',
  },
  'shopify-dtc': {
    titleMax: 70,
    bulletMax: 200,
    descGuide: 'Markdown supported. Hero benefit + 3 features + 1 social proof prompt.',
    keywordsGuide: 'SEO meta keywords; up to 20.',
  },
  'shopee-sg': {
    titleMax: 120,
    bulletMax: 200,
    descGuide: 'Plain text, mobile-friendly, use emoji sparingly.',
    keywordsGuide: 'Lowercase tokens, ≤25.',
  },
  'lazada-sg': {
    titleMax: 255,
    bulletMax: 200,
    descGuide: 'Plain text, mobile-friendly.',
    keywordsGuide: 'Lowercase tokens, ≤25.',
  },
  'walmart': {
    titleMax: 100,
    bulletMax: 250,
    descGuide: 'Plain text, 1-2 paragraphs, factual tone.',
    keywordsGuide: 'Up to 20 keywords.',
  },
};

const SYSTEM_PROMPT = `You are a senior cross-border e-commerce listing copywriter.
Output strict JSON matching the schema.
You write in the requested language natively (do not translate from English).
You optimize for the platform's discovery algorithm (Amazon = SEO + benefits, TikTok Shop = hook + scroll-stop, Etsy = story + occasion, Shopify = brand voice).
You know 2026 algorithm updates: keyword stuffing hurts ranking; semantic relevance + on-page conversion signals win.
You never fabricate certifications, medical claims, or competitor brand mentions.`;
