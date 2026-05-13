import type { ListingDraftRow } from './storage';

export type ExportFormat = 'csv' | 'markdown' | 'json' | 'amazon-loader';

export interface ExportPayload {
  body: string;
  contentType: string;
  filename: string;
}

export function exportListing(
  draft: ListingDraftRow,
  format: ExportFormat,
): ExportPayload {
  const slug = sanitizeSlug(`${draft.platform}-${draft.language}-${draft.id.slice(0, 8)}`);
  switch (format) {
    case 'csv':
      return {
        body: toCsv([draft]),
        contentType: 'text/csv; charset=utf-8',
        filename: `${slug}.csv`,
      };
    case 'markdown':
      return {
        body: toMarkdown(draft),
        contentType: 'text/markdown; charset=utf-8',
        filename: `${slug}.md`,
      };
    case 'json':
      return {
        body: toJson(draft),
        contentType: 'application/json; charset=utf-8',
        filename: `${slug}.json`,
      };
    case 'amazon-loader':
      return {
        body: toAmazonLoader([draft]),
        contentType: 'text/csv; charset=utf-8',
        filename: `amazon-loader-${slug}.csv`,
      };
    default: {
      const exhaustive: never = format;
      throw new Error(`Unknown export format: ${exhaustive as string}`);
    }
  }
}

export function exportListings(
  drafts: ListingDraftRow[],
  format: ExportFormat,
): ExportPayload {
  if (drafts.length === 0) {
    throw new Error('没有可导出的草稿。');
  }
  const stamp = new Date().toISOString().slice(0, 10);
  switch (format) {
    case 'csv':
      return {
        body: toCsv(drafts),
        contentType: 'text/csv; charset=utf-8',
        filename: `listings-${stamp}.csv`,
      };
    case 'markdown':
      return {
        body: drafts.map((d) => toMarkdown(d)).join('\n\n---\n\n'),
        contentType: 'text/markdown; charset=utf-8',
        filename: `listings-${stamp}.md`,
      };
    case 'json':
      return {
        body: JSON.stringify(
          { exported_at: new Date().toISOString(), drafts: drafts.map(serialize) },
          null,
          2,
        ),
        contentType: 'application/json; charset=utf-8',
        filename: `listings-${stamp}.json`,
      };
    case 'amazon-loader':
      return {
        body: toAmazonLoader(drafts),
        contentType: 'text/csv; charset=utf-8',
        filename: `amazon-loader-${stamp}.csv`,
      };
    default: {
      const exhaustive: never = format;
      throw new Error(`Unknown export format: ${exhaustive as string}`);
    }
  }
}

/* ── format builders ─────────────────────────────────────────── */

function toMarkdown(d: ListingDraftRow): string {
  const bullets = parseList<string>(d.bullets);
  const keywords = parseList<string>(d.search_keywords);
  const warnings = parseList<string>(d.warnings);
  const lines: string[] = [
    `# ${d.title ?? '(untitled)'}`,
    '',
    `**Platform:** ${d.platform}  `,
    `**Language:** ${d.language}  `,
    `**Status:** ${d.status}  `,
    `**Updated:** ${d.updated_at ?? '-'}`,
    '',
  ];
  if (bullets.length) {
    lines.push('## Bullets', ...bullets.map((b) => `- ${b}`), '');
  }
  if (d.description) {
    lines.push('## Description', '', d.description, '');
  }
  if (keywords.length) {
    lines.push('## Backend Keywords', '', '```', keywords.join(' '), '```', '');
  }
  if (warnings.length) {
    lines.push(
      '## ⚠️ Compliance Warnings (must read)',
      ...warnings.map((w) => `- ${w}`),
      '',
    );
  }
  return lines.join('\n');
}

function toJson(d: ListingDraftRow): string {
  return JSON.stringify(serialize(d), null, 2);
}

function serialize(d: ListingDraftRow): Record<string, unknown> {
  return {
    id: d.id,
    input_id: d.input_id,
    platform: d.platform,
    language: d.language,
    status: d.status,
    title: d.title,
    bullets: parseList<string>(d.bullets),
    description: d.description,
    search_keywords: parseList<string>(d.search_keywords),
    warnings: parseList<string>(d.warnings),
    failure_reason: d.failure_reason,
    created_at: d.created_at,
    updated_at: d.updated_at,
  };
}

function toCsv(drafts: ListingDraftRow[]): string {
  const headers = [
    'platform',
    'language',
    'status',
    'title',
    'bullet_1',
    'bullet_2',
    'bullet_3',
    'bullet_4',
    'bullet_5',
    'bullet_6',
    'bullet_7',
    'bullet_8',
    'description',
    'search_keywords',
    'warnings',
    'updated_at',
  ];
  const rows = drafts.map((d) => {
    const bullets = parseList<string>(d.bullets);
    const padded = Array.from({ length: 8 }, (_, i) => bullets[i] ?? '');
    const keywords = parseList<string>(d.search_keywords).join(' ');
    const warnings = parseList<string>(d.warnings).join(' | ');
    return [
      d.platform,
      d.language,
      d.status,
      d.title ?? '',
      ...padded,
      d.description ?? '',
      keywords,
      warnings,
      d.updated_at ?? '',
    ];
  });
  return [headers, ...rows].map((r) => r.map(csvField).join(',')).join('\n') + '\n';
}

/**
 * Approximate Amazon "Inventory Loader" / category-listing format.
 * The real Amazon template per category has ~100 columns; we emit the
 * universally required core columns so the user can paste-merge into the
 * exact platform template they downloaded from Seller Central.
 */
function toAmazonLoader(drafts: ListingDraftRow[]): string {
  const headers = [
    'sku',
    'product-id',
    'product-id-type',
    'price',
    'minimum-seller-allowed-price',
    'maximum-seller-allowed-price',
    'item-condition',
    'quantity',
    'product_name',
    'product_description',
    'bullet_point1',
    'bullet_point2',
    'bullet_point3',
    'bullet_point4',
    'bullet_point5',
    'generic_keywords',
  ];
  const rows = drafts.map((d) => {
    const bullets = parseList<string>(d.bullets);
    const padded = Array.from({ length: 5 }, (_, i) => bullets[i] ?? '');
    const keywords = parseList<string>(d.search_keywords).join(' ');
    return [
      `SKU-${d.id.slice(0, 8).toUpperCase()}`,
      '', // product-id (UPC/EAN/ASIN — user fills)
      'UPC',
      '', // price
      '', // min
      '', // max
      'New',
      '0', // quantity — user adjusts
      d.title ?? '',
      d.description ?? '',
      ...padded,
      keywords,
    ];
  });
  // Amazon uses tab-separated for inventory loader, not comma. We follow that
  // so the output drops directly into Seller Central upload.
  return (
    [headers, ...rows].map((r) => r.map(tsvField).join('\t')).join('\n') + '\n'
  );
}

/* ── helpers ─────────────────────────────────────────────────── */

function csvField(raw: string | number): string {
  const s = String(raw ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function tsvField(raw: string | number): string {
  // strip newlines and tabs to keep one-row-per-listing for Seller Central
  return String(raw ?? '').replace(/[\t\r\n]+/g, ' ');
}

function parseList<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function sanitizeSlug(s: string): string {
  return s.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'listing';
}
