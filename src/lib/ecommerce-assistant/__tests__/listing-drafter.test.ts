import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';
import { createAppDataStore } from '@/lib/app/runtime/data-store';

import { draftListingForInput, ListingDrafterError } from '../listing-drafter';
import { listListingDrafts } from '../storage';
import type { ListingDraftRecord, ProductInputRecord } from '../types';

const APP_ID = 'ecommerce-assistant';

// generateStructured is private to the LLM client; mock it at the module level
// so tests are deterministic and exercise both the success and failure paths
// without needing a real LLM provider.
const fakeStructured = jest.fn<unknown, unknown[]>();
jest.mock('../llm-client', () => ({
  generateStructured: (...args: unknown[]) => fakeStructured(...args),
  EcommerceLlmUnavailableError: class extends Error {},
}));

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

describe('draftListingForInput', () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAppDataStore>;

  beforeEach(() => {
    db = setupDb();
    store = createAppDataStore(db, APP_ID);
    fakeStructured.mockReset();
  });

  afterEach(() => {
    db.close();
  });

  function seedInput(overrides: Partial<ProductInputRecord> = {}): string {
    const created = store.create<ProductInputRecord>('product_inputs', {
      title: 'Travel Mug 16oz',
      category_hint: 'kitchen-drinkware',
      main_image_path: '/tmp/x.png',
      status: 'ready',
      ...overrides,
    });
    return (created as { id: string }).id;
  }

  it('writes a ready draft with title / bullets / description on success', async () => {
    fakeStructured.mockResolvedValueOnce({
      title: 'Vacuum Insulated 16oz Travel Mug | Leak-Proof Lid',
      bullets: [
        'Stays hot 12 hours / cold 24 hours',
        'Leak-proof slide lid',
        'Fits standard car cup holders',
      ],
      description: 'A daily-driver travel mug.',
      search_keywords: ['travel mug', 'insulated', 'leakproof'],
      warnings: [],
    });
    const inputId = seedInput();

    const { draft } = await draftListingForInput(store, {
      inputId,
      platform: 'amazon-us',
      language: 'en',
    });

    expect(draft.status).toBe('ready');
    expect(draft.platform).toBe('amazon-us');
    expect(draft.language).toBe('en');
    expect(draft.title).toContain('Vacuum Insulated');
    const bullets = JSON.parse(draft.bullets ?? '[]') as string[];
    expect(bullets).toHaveLength(3);
    const keywords = JSON.parse(draft.search_keywords ?? '[]') as string[];
    expect(keywords).toContain('travel mug');
  });

  it('captures warnings from the model in JSON', async () => {
    fakeStructured.mockResolvedValueOnce({
      title: 'Premium Pet Bowl',
      bullets: ['Stainless steel', 'Dishwasher safe', 'Anti-slip base'],
      description: 'Solid construction.',
      search_keywords: [],
      warnings: ['Avoid medical claims about pet health.'],
    });
    const inputId = seedInput({ title: 'Pet Bowl' });

    const { draft } = await draftListingForInput(store, {
      inputId,
      platform: 'etsy',
      language: 'en',
    });
    const warnings = JSON.parse(draft.warnings ?? '[]') as string[];
    expect(warnings[0]).toContain('medical claims');
  });

  it('marks the draft failed and propagates a ListingDrafterError on LLM failure', async () => {
    fakeStructured.mockRejectedValueOnce(new Error('TEST: boom'));
    const inputId = seedInput();

    await expect(
      draftListingForInput(store, {
        inputId,
        platform: 'amazon-us',
        language: 'en',
      }),
    ).rejects.toBeInstanceOf(ListingDrafterError);

    const drafts = listListingDrafts(store, { input_id: inputId });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].status).toBe('failed');
    expect(drafts[0].failure_reason).toContain('TEST: boom');
  });

  it('throws when the input does not exist', async () => {
    await expect(
      draftListingForInput(store, {
        inputId: 'does_not_exist',
        platform: 'amazon-us',
        language: 'en',
      }),
    ).rejects.toBeInstanceOf(ListingDrafterError);
  });

  it('persists each draft as a separate row per (input × platform × language)', async () => {
    fakeStructured.mockResolvedValue({
      title: 't',
      bullets: ['a', 'b', 'c'],
      description: 'd',
      search_keywords: [],
      warnings: [],
    });
    const inputId = seedInput();
    await draftListingForInput(store, { inputId, platform: 'amazon-us', language: 'en' });
    await draftListingForInput(store, { inputId, platform: 'tiktok-shop-us', language: 'en' });
    await draftListingForInput(store, { inputId, platform: 'amazon-jp', language: 'ja' });

    const all = store.query<ListingDraftRecord>('listing_drafts', { limit: 100 });
    expect(all).toHaveLength(3);
    const platforms = all.map((r) => r.platform).sort();
    expect(platforms).toEqual(['amazon-jp', 'amazon-us', 'tiktok-shop-us']);
  });
});
