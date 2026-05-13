import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { migrateAppTables } from '@/lib/db/migrations-app';
import { createAppDataStore } from '@/lib/app/runtime/data-store';

import {
  promoteCandidateToInput,
  DiscoverResearchError,
} from '../discover';
import { createCandidate, listCandidates } from '../storage';
import type { ProductBriefRecord, ProductInputRecord } from '../types';

// generateImages depends on a configured image provider. Stub it to a known
// failure path so tests are deterministic and exercise the graceful-degrade
// branch (input still created, main_image_path empty, failure_reason set).
jest.mock('@/lib/image', () => ({
  generateImages: jest.fn(async () => {
    throw new Error('TEST: no image provider configured');
  }),
}));

const APP_ID = 'ecommerce-assistant';
const originalFetch = global.fetch;
const originalDataDir = process.env.LUMOS_DATA_DIR;

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  db.prepare(
    `INSERT INTO lumos_app_apps (id, name, version, manifest_json, source, install_path, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(APP_ID, APP_ID, '0.1.0', '{}', 'builtin', '/tmp/' + APP_ID, Date.now());
  return db;
}

describe('promoteCandidateToInput', () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAppDataStore>;
  let testDataDir: string;

  beforeEach(() => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-ecommerce-promote-'));
    process.env.LUMOS_DATA_DIR = testDataDir;
    db = setupDb();
    store = createAppDataStore(db, APP_ID);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalDataDir === undefined) {
      delete process.env.LUMOS_DATA_DIR;
    } else {
      process.env.LUMOS_DATA_DIR = originalDataDir;
    }
    fs.rmSync(testDataDir, { recursive: true, force: true });
    db.close();
  });

  it('creates a product_input from a ready candidate and marks it promoted', async () => {
    const candidate = createCandidate(store, {
      research_id: 'r_test',
      keyword: 'portable coffee mug',
      market: 'US',
      product_name: 'Vacuum Insulated 16oz Travel Mug',
      category: 'kitchen-drinkware',
      score_demand: 80,
      score_competition: 55,
      score_profit: 65,
      score_compliance: 90,
      score_logistics: 70,
      score_total: 71,
      summary: 'Mature category but room for differentiated lid design.',
      selling_points: JSON.stringify(['leak-proof lid', 'fits car cup holder']),
      risks: JSON.stringify(['saturated market', 'shipping cost']),
      differentiation: 'Add silicone gasket to address leak complaints.',
      reference_urls: JSON.stringify([
        { platform: 'Amazon US', url: 'https://www.amazon.com/s?k=travel+mug' },
      ]),
      source_search_urls: JSON.stringify([
        { platform: '1688', url: 'https://s.1688.com/selloffer/offer_search.htm?keywords=travel+mug' },
      ]),
      status: 'ready',
    });

    const result = await promoteCandidateToInput(store, candidate.id);

    expect(result.inputId).toBeTruthy();
    expect(result.candidate.status).toBe('promoted');
    expect(result.candidate.promoted_input_id).toBe(result.inputId);
    // Image generation was stubbed to fail; main_image_path should be empty
    // and failure reason captured.
    expect(result.conceptImagePath).toBeNull();
    expect(result.conceptImageFailed).toContain('TEST: no image provider configured');

    const input = store.get<ProductInputRecord>('product_inputs', result.inputId);
    expect(input).not.toBeNull();
    expect(input?.title).toBe('Vacuum Insulated 16oz Travel Mug');
    expect(input?.category_hint).toBe('kitchen-drinkware');
    // promote MUST NOT auto-fill main_image_path — concept image is reference
    // only; the user explicitly chooses to upload real or use as placeholder.
    expect(input?.main_image_path).toBe('');
    expect(input?.note).toContain('[来自选品]');
    expect(input?.note).toContain('差异化');
    expect(input?.note).toContain('参考竞品');
    expect(input?.note).toContain('货源搜索');

    // brief should be synthesized from candidate so listing-drafter can run
    // without waiting for an image SOP job.
    const briefs = store.query<ProductBriefRecord>('product_briefs', {
      filter: { input_id: result.inputId },
      limit: 5,
    });
    expect(briefs).toHaveLength(1);
    expect(briefs[0].product_type).toBe('Vacuum Insulated 16oz Travel Mug');
    expect(briefs[0].category_bucket).toBe('kitchen-drinkware');
    expect(briefs[0].confidence).toBe(4);
    const sellingPoints = JSON.parse(briefs[0].core_selling_points ?? '[]') as string[];
    expect(sellingPoints).toContain('leak-proof lid');
    const raw = JSON.parse(briefs[0].raw_brief ?? '{}') as { source: string; differentiation: string };
    expect(raw.source).toBe('discover-promoted');
    expect(raw.differentiation).toContain('silicone gasket');
  });

  it('is idempotent — promoting the same candidate twice returns the same input', async () => {
    const candidate = createCandidate(store, {
      research_id: 'r_test',
      keyword: 'cat fountain',
      market: 'JP',
      product_name: 'Quiet Stainless Steel Pet Water Fountain',
      category: 'pet',
      score_total: 60,
      status: 'ready',
    });

    const first = await promoteCandidateToInput(store, candidate.id);
    const second = await promoteCandidateToInput(store, candidate.id);

    expect(second.inputId).toBe(first.inputId);
    const allInputs = store.query('product_inputs');
    expect(allInputs).toHaveLength(1);
  });

  it('uses a real product detail image as the workshop main image when available', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axh3YoAAAAASUVORK5CYII=',
      'base64',
    );
    global.fetch = jest.fn(() =>
      Promise.resolve(new Response(png, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })),
    ) as unknown as typeof fetch;

    const candidate = createCandidate(store, {
      research_id: 'r_test',
      keyword: 'portable coffee mug',
      market: 'US',
      product_name: 'Premium Travel Mug 16oz',
      category: 'kitchen-drinkware',
      score_total: 70,
      sources: JSON.stringify([
        {
          kind: 'live-fetch',
          source: 'amazon-us',
          details: [
            {
              rank: 1,
              title: 'Premium Travel Mug 16oz',
              url: 'https://www.amazon.com/dp/B001',
              image_url: 'https://images.example.test/mug.png',
              bullet_points: ['Leak proof lid'],
              fetched_at: '2026-05-10T08:00:00Z',
              fetched_via: 'server-fetch',
            },
          ],
        },
      ]),
      status: 'ready',
    });

    const result = await promoteCandidateToInput(store, candidate.id);
    const input = store.get<ProductInputRecord>('product_inputs', result.inputId);

    expect(input?.main_image_path).toContain('.lumos-uploads/ecommerce-assistant');
    expect(fs.existsSync(input?.main_image_path ?? '')).toBe(true);
    expect(input?.note).toContain('真实商品详情');
    expect(input?.note).toContain('可直接进入工坊出图');
  });

  it('throws DiscoverResearchError when candidate id is missing', async () => {
    await expect(promoteCandidateToInput(store, 'does_not_exist')).rejects.toBeInstanceOf(
      DiscoverResearchError,
    );
  });

  it('listCandidates returns rows ordered by score_total descending', () => {
    createCandidate(store, {
      research_id: 'r1',
      keyword: 'k',
      market: 'US',
      product_name: 'low',
      category: 'a',
      score_total: 40,
      status: 'ready',
    });
    createCandidate(store, {
      research_id: 'r1',
      keyword: 'k',
      market: 'US',
      product_name: 'high',
      category: 'a',
      score_total: 88,
      status: 'ready',
    });
    createCandidate(store, {
      research_id: 'r1',
      keyword: 'k',
      market: 'US',
      product_name: 'mid',
      category: 'a',
      score_total: 60,
      status: 'ready',
    });

    const sorted = listCandidates(store);
    expect(sorted.map((c) => c.product_name)).toEqual(['high', 'mid', 'low']);
  });
});
