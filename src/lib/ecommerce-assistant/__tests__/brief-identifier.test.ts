import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';
import { createAppDataStore } from '@/lib/app/runtime/data-store';

import { identifyBriefForInput, BriefIdentifyError } from '../brief-identifier';
import type { ProductBriefRecord, ProductInputRecord } from '../types';

const APP_ID = 'ecommerce-assistant';

const fakeIdentify = jest.fn<unknown, unknown[]>();
jest.mock('../llm-client', () => ({
  identifyProductBrief: (...args: unknown[]) => fakeIdentify(...args),
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

describe('identifyBriefForInput', () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAppDataStore>;

  beforeEach(() => {
    db = setupDb();
    store = createAppDataStore(db, APP_ID);
    fakeIdentify.mockReset();
  });

  afterEach(() => {
    db.close();
  });

  function seedInput(main: string): string {
    const created = store.create<ProductInputRecord>('product_inputs', {
      title: 'Test',
      main_image_path: main,
      status: 'ready',
    });
    return (created as { id: string }).id;
  }

  it('refuses to identify when input has no main image', async () => {
    const id = seedInput('');
    await expect(identifyBriefForInput(store, id)).rejects.toBeInstanceOf(BriefIdentifyError);
    expect(fakeIdentify).not.toHaveBeenCalled();
  });

  it('upserts brief with high confidence when LLM identifies successfully', async () => {
    fakeIdentify.mockResolvedValueOnce({
      productType: 'travel-mug',
      categoryBucket: 'kitchen-drinkware',
      sizeClass: 'small',
      coreSellingPoints: ['leak-proof', 'insulated'],
      targetAudience: ['commuter'],
      recommendedAspectRatio: '4:5',
      recommendedShotType: 'tabletop',
      fidelityFocus: ['lid mechanism'],
      consistencyAnchors: ['matte black finish'],
      avoidElements: ['liquid splash'],
      confidence: 8,
    });
    const id = seedInput('/tmp/photo.png');

    const briefRow = await identifyBriefForInput(store, id);
    expect(briefRow.confidence).toBe(8);
    expect(briefRow.product_type).toBe('travel-mug');
    expect(briefRow.input_id).toBe(id);

    const stored = store.query<ProductBriefRecord>('product_briefs', {
      filter: { input_id: id },
      limit: 5,
    });
    expect(stored).toHaveLength(1);
    const points = JSON.parse(stored[0].core_selling_points ?? '[]') as string[];
    expect(points).toContain('leak-proof');
    const raw = JSON.parse(stored[0].raw_brief ?? '{}') as { source: string };
    expect(raw.source).toBe('identified-from-photo');
  });

  it('replaces a previously synthesized brief (upsert by input_id)', async () => {
    // Pre-seed a synthesized low-confidence brief.
    store.create<ProductBriefRecord>('product_briefs', {
      input_id: 'placeholder',
      product_type: 'old',
      confidence: 4,
    });
    fakeIdentify.mockResolvedValueOnce({
      productType: 'travel-mug',
      categoryBucket: 'kitchen',
      sizeClass: 'small',
      coreSellingPoints: [],
      targetAudience: [],
      recommendedAspectRatio: '4:5',
      recommendedShotType: 'tabletop',
      fidelityFocus: [],
      consistencyAnchors: [],
      avoidElements: [],
      confidence: 9,
    });
    const id = seedInput('/tmp/p.png');
    // Pre-existing brief for THIS input
    store.create<ProductBriefRecord>('product_briefs', {
      input_id: id,
      product_type: 'synthesized',
      confidence: 4,
    });

    await identifyBriefForInput(store, id);

    const briefs = store.query<ProductBriefRecord>('product_briefs', {
      filter: { input_id: id },
      limit: 5,
    });
    expect(briefs).toHaveLength(1); // upsert, not duplicate
    expect(briefs[0].product_type).toBe('travel-mug');
    expect(briefs[0].confidence).toBe(9);
  });

  it('wraps LLM errors in BriefIdentifyError', async () => {
    fakeIdentify.mockRejectedValueOnce(new Error('TEST: LLM down'));
    const id = seedInput('/tmp/p.png');
    await expect(identifyBriefForInput(store, id)).rejects.toBeInstanceOf(BriefIdentifyError);
  });

  it('throws BriefIdentifyError when input id does not exist', async () => {
    await expect(identifyBriefForInput(store, 'nope')).rejects.toBeInstanceOf(BriefIdentifyError);
  });
});
