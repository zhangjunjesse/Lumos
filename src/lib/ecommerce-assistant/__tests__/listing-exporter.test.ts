import { exportListing, exportListings } from '../listing-exporter';
import type { ListingDraftRow } from '../storage';

function makeDraft(over: Partial<ListingDraftRow> = {}): ListingDraftRow {
  return {
    id: '1234567890abcdef',
    input_id: 'input-1',
    platform: 'amazon-us',
    language: 'en',
    status: 'ready',
    title: 'Vacuum Insulated 16oz Travel Mug',
    bullets: JSON.stringify([
      'Stays hot 12h / cold 24h',
      'Leak-proof slide lid',
      'Fits car cup holders',
    ]),
    description: 'A daily-driver travel mug for commuters.',
    search_keywords: JSON.stringify(['travel mug', 'insulated', 'leakproof']),
    warnings: JSON.stringify(['Avoid medical claims about hydration.']),
    failure_reason: null,
    created_at: '2026-05-09T08:00:00Z',
    updated_at: '2026-05-09T08:30:00Z',
    ...over,
  } as ListingDraftRow;
}

describe('exportListing', () => {
  it('csv has header row and properly escapes quotes / commas / newlines', () => {
    const tricky = makeDraft({
      title: 'Mug, "Best", with newline\nhere',
      description: 'Line A\nLine B, with quotes "ok"',
    });
    const csv = exportListing(tricky, 'csv').body;
    // Per RFC 4180 fields containing , " or newline must be quoted; embedded
    // quotes are doubled. Don't naive-split on newline because the title
    // legitimately contains one inside its quoted field.
    expect(csv.startsWith('platform,language,status,title,bullet_1')).toBe(true);
    expect(csv).toContain('"Mug, ""Best"", with newline\nhere"');
    expect(csv).toContain('"Line A\nLine B, with quotes ""ok"""');
  });

  it('markdown contains Title heading and bullets section', () => {
    const md = exportListing(makeDraft(), 'markdown').body;
    expect(md).toContain('# Vacuum Insulated 16oz Travel Mug');
    expect(md).toContain('## Bullets');
    expect(md).toContain('- Stays hot 12h / cold 24h');
    expect(md).toContain('## Description');
    expect(md).toContain('## Backend Keywords');
    expect(md).toContain('travel mug insulated leakproof');
    expect(md).toContain('## ⚠️ Compliance Warnings');
  });

  it('json round-trips structured fields', () => {
    const json = JSON.parse(exportListing(makeDraft(), 'json').body) as {
      platform: string;
      bullets: string[];
      search_keywords: string[];
      warnings: string[];
    };
    expect(json.platform).toBe('amazon-us');
    expect(json.bullets).toHaveLength(3);
    expect(json.search_keywords).toContain('insulated');
    expect(json.warnings[0]).toContain('medical claims');
  });

  it('amazon-loader uses tab separator and core columns', () => {
    const out = exportListing(makeDraft(), 'amazon-loader').body;
    const [header, row] = out.split('\n');
    expect(header.split('\t')).toContain('product_name');
    expect(header.split('\t')).toContain('bullet_point1');
    expect(header.split('\t')).toContain('generic_keywords');
    const fields = row.split('\t');
    expect(fields[fields.length - 1]).toBe('travel mug insulated leakproof');
  });

  it('content-type and filename hints match format', () => {
    expect(exportListing(makeDraft(), 'csv').contentType).toContain('text/csv');
    expect(exportListing(makeDraft(), 'markdown').contentType).toContain('text/markdown');
    expect(exportListing(makeDraft(), 'json').contentType).toContain('application/json');
    expect(exportListing(makeDraft(), 'amazon-loader').filename).toMatch(/^amazon-loader-/);
  });
});

describe('exportListings (batch)', () => {
  it('csv batch contains one header + N rows', () => {
    const drafts = [
      makeDraft({ id: 'a000', title: 'A' }),
      makeDraft({ id: 'b000', title: 'B' }),
      makeDraft({ id: 'c000', title: 'C' }),
    ];
    const csv = exportListings(drafts, 'csv').body;
    const lines = csv.split('\n').filter(Boolean);
    expect(lines).toHaveLength(4); // header + 3 rows
  });

  it('markdown batch joins drafts with separator', () => {
    const drafts = [makeDraft({ id: 'a000', title: 'A' }), makeDraft({ id: 'b000', title: 'B' })];
    const md = exportListings(drafts, 'markdown').body;
    expect(md).toContain('# A');
    expect(md).toContain('# B');
    expect(md).toContain('---');
  });

  it('json batch wraps drafts in envelope with timestamp', () => {
    const drafts = [makeDraft()];
    const wrapped = JSON.parse(exportListings(drafts, 'json').body) as {
      exported_at: string;
      drafts: unknown[];
    };
    expect(wrapped.exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(wrapped.drafts).toHaveLength(1);
  });

  it('throws on empty drafts', () => {
    expect(() => exportListings([], 'csv')).toThrow();
  });
});
