import Database from 'better-sqlite3';
import { createAppDataStore } from '@/lib/app/runtime/data-store';
import { migrateAppTables } from '@/lib/db/migrations-app';

import { setBrowserFetchSettings } from '../discover-settings';
import { ingestProductFromUrl, UrlIngestError } from '../url-ingest';
import type { ProductInputRecord } from '../types';

const fakeFetchViaBrowser = jest.fn<unknown, unknown[]>();
jest.mock('../browser-fetcher', () => ({
  fetchViaBrowser: (...args: unknown[]) => fakeFetchViaBrowser(...args),
  BrowserFetchError: class extends Error {
    constructor(msg: string, public stage: string) {
      super(msg);
    }
  },
}));

const fakeStructured = jest.fn<unknown, unknown[]>();
jest.mock('../llm-client', () => ({
  generateStructured: (...args: unknown[]) => fakeStructured(...args),
  EcommerceLlmUnavailableError: class extends Error {},
}));

const fakePersist = jest.fn();
jest.mock('../upload', () => ({
  persistImageBuffer: (...args: unknown[]) => fakePersist(...args),
}));

const originalFetch = global.fetch;
afterAll(() => {
  global.fetch = originalFetch;
});

const APP_ID = 'ecommerce-assistant';

function setupStore() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  db.prepare(
    `INSERT INTO lumos_app_apps (id, name, version, manifest_json, source, install_path, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(APP_ID, APP_ID, '0.1.0', '{}', 'builtin', '/tmp/' + APP_ID, Date.now());
  return { db, store: createAppDataStore(db, APP_ID) };
}

const HERO_PNG = Buffer.from('89504e470d0a1a0a' + '00'.repeat(20), 'hex');

function pngFetchOk() {
  global.fetch = jest.fn(async () => ({
    ok: true,
    headers: { get: () => 'image/png' },
    arrayBuffer: async () => HERO_PNG.buffer.slice(HERO_PNG.byteOffset, HERO_PNG.byteOffset + HERO_PNG.byteLength),
  })) as unknown as typeof fetch;
}

describe('ingestProductFromUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fakePersist.mockImplementation((args: { filename?: string }) => ({
      absolutePath: `/tmp/lumos/${args.filename ?? 'img.png'}`,
      relativePath: args.filename ?? 'img.png',
      size: 32,
      mimeType: 'image/png',
    }));
  });

  it('happy path: amazon-style HTML → adapter parse → image download → product_input row', async () => {
    const { db, store } = setupStore();
    setBrowserFetchSettings(store, { enabled: true, browserContextId: 'embedded:default' });
    fakeFetchViaBrowser.mockResolvedValue({
      url: 'https://www.amazon.com/dp/B09TEST',
      title: 'mock',
      html: `<html><head><title>Test</title></head><body>
        <span id="productTitle">Test Bottle 32oz</span>
        <img id="landingImage" src="https://m.media-amazon.com/i/x.jpg"
          data-old-hires="https://m.media-amazon.com/i/hi.jpg" />
        <div id="feature-bullets"><ul>
          <li><span class="a-list-item">Holds 32 ounces of cold liquid for 24 hours.</span></li>
          <li><span class="a-list-item">Made from 18/8 stainless steel.</span></li>
        </ul></div></div>
      </body></html>`,
      elapsedMs: 100,
      browserContextId: 'embedded:default',
    });
    pngFetchOk();

    const result = await ingestProductFromUrl({ url: 'https://www.amazon.com/dp/B09TEST', store });
    expect(result.adapterId).toBe('amazon');
    expect(result.llmFallbackUsed).toBe(false);
    expect(result.parsedProduct.title).toContain('Test Bottle 32oz');
    expect(fakePersist).toHaveBeenCalledTimes(1);

    const created = store.get<ProductInputRecord>('product_inputs', result.inputId);
    expect(created?.title).toContain('Test Bottle 32oz');
    expect(created?.main_image_path).toBe('/tmp/lumos/hi.jpg');
    db.close();
  });

  it('refuses when browser fetch is disabled', async () => {
    const { db, store } = setupStore();
    setBrowserFetchSettings(store, { enabled: false, browserContextId: 'embedded:default' });
    await expect(
      ingestProductFromUrl({ url: 'https://www.amazon.com/dp/B09TEST', store }),
    ).rejects.toBeInstanceOf(UrlIngestError);
    db.close();
  });

  it('falls through to LLM when site has neither JSON-LD nor adapter signals', async () => {
    const { db, store } = setupStore();
    setBrowserFetchSettings(store, { enabled: true, browserContextId: 'embedded:default' });
    fakeFetchViaBrowser.mockResolvedValue({
      url: 'https://random.shop/p/x',
      title: 'mock',
      html: '<html><body><div>opaque SPA shell</div></body></html>',
      elapsedMs: 100,
      browserContextId: 'embedded:default',
    });
    fakeStructured.mockResolvedValue({
      title: 'LLM Recovered Product',
      main_image: 'https://random.shop/img/main.jpg',
      gallery: ['https://random.shop/img/2.jpg'],
      price: '$45',
      bullets: ['Bullet A', 'Bullet B'],
      description: 'Long description.',
      category: 'Gadgets',
      brand: 'Brand X',
    });
    pngFetchOk();

    const result = await ingestProductFromUrl({ url: 'https://random.shop/p/x', store });
    expect(result.llmFallbackUsed).toBe(true);
    expect(result.parsedProduct.title).toBe('LLM Recovered Product');
    expect(result.galleryCount).toBe(1);
    db.close();
  });

  it('refuses when no main image can be found even after LLM', async () => {
    const { db, store } = setupStore();
    setBrowserFetchSettings(store, { enabled: true, browserContextId: 'embedded:default' });
    fakeFetchViaBrowser.mockResolvedValue({
      url: 'https://x.test/',
      title: '',
      html: '<html><body><h1>Just text</h1></body></html>',
      elapsedMs: 100,
      browserContextId: 'embedded:default',
    });
    fakeStructured.mockResolvedValue({
      title: 'Just text',
      main_image: null,
      gallery: [],
      price: null,
      bullets: [],
      description: null,
      category: null,
      brand: null,
    });

    await expect(
      ingestProductFromUrl({ url: 'https://x.test/', store }),
    ).rejects.toMatchObject({ stage: 'parse' });
    db.close();
  });
});
