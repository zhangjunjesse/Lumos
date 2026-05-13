import Database from 'better-sqlite3';
import { createAppDataStore } from '@/lib/app/runtime/data-store';
import { migrateAppTables } from '@/lib/db/migrations-app';
import { buildPlatformSearchUrl, fetchSearchSamples } from '../web-research';
import { setBrowserFetchSettings } from '../discover-settings';

const fakeStructured = jest.fn<unknown, unknown[]>();
jest.mock('../llm-client', () => ({
  generateStructured: (...args: unknown[]) => fakeStructured(...args),
  EcommerceLlmUnavailableError: class extends Error {},
}));

const mockResolveBrowserBridgeRuntimeConfig = jest.fn();
const mockPostToBrowserBridge = jest.fn();
jest.mock('@/lib/browser-runtime/bridge-client', () => ({
  resolveBrowserBridgeRuntimeConfig: (...args: unknown[]) => mockResolveBrowserBridgeRuntimeConfig(...args),
  postToBrowserBridge: (...args: unknown[]) => mockPostToBrowserBridge(...args),
}));

const originalFetch = global.fetch;
afterAll(() => {
  global.fetch = originalFetch;
});

const APP_ID = 'ecommerce-assistant';

function mockFetch(impl: (url: string) => Response | Promise<Response>) {
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    return Promise.resolve(impl(url));
  }) as unknown as typeof fetch;
}

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

describe('buildPlatformSearchUrl', () => {
  it('builds canonical Amazon US URL with URL-encoded keyword', () => {
    const out = buildPlatformSearchUrl('amazon-us', 'travel mug 16oz');
    expect(out).toEqual({
      source: 'amazon-us',
      url: 'https://www.amazon.com/s?k=travel%20mug%2016oz',
      acceptLanguage: 'en-US,en;q=0.9',
    });
  });

  it('handles "amazon" alias as amazon-us', () => {
    const out = buildPlatformSearchUrl('amazon', 'kettle');
    expect(out?.url).toContain('amazon.com');
  });

  it('returns null for unknown platforms', () => {
    expect(buildPlatformSearchUrl('mars-shop', 'rocket')).toBeNull();
  });

  it('localizes Accept-Language for JP', () => {
    const out = buildPlatformSearchUrl('amazon-jp', 'water bottle');
    expect(out?.acceptLanguage).toContain('ja');
  });
});

describe('fetchSearchSamples', () => {
  beforeEach(() => {
    fakeStructured.mockReset();
    mockResolveBrowserBridgeRuntimeConfig.mockReset();
    mockPostToBrowserBridge.mockReset();
  });

  it('returns empty + warning on HTTP error (non-2xx)', async () => {
    mockFetch(() => new Response('forbidden', { status: 403 }));
    const out = await fetchSearchSamples({
      source: 'amazon-us',
      url: 'https://www.amazon.com/s?k=foo',
    });
    expect(out.samples).toEqual([]);
    expect(out.warning).toContain('403');
    expect(fakeStructured).not.toHaveBeenCalled();
  });

  it('detects amazon captcha / robot-check page', async () => {
    const html =
      '<html><body><h4>Type the characters you see in this image:</h4><div>captcha</div><p>To discuss automated access</p></body></html>';
    mockFetch(() => new Response(html, { status: 200 }));
    const out = await fetchSearchSamples({
      source: 'amazon-us',
      url: 'https://www.amazon.com/s?k=foo',
    });
    expect(out.samples).toEqual([]);
    expect(out.warning).toMatch(/automated access|验证码/);
    expect(fakeStructured).not.toHaveBeenCalled();
  });

  it('detects Amazon Akamai interstitial verification pages', async () => {
    const html = '<html><head><script src="/_sec/verify?provider=interstitial"></script></head><body><script>var bm_verify = true;</script></body></html>';
    mockFetch(() => new Response(html, { status: 200 }));
    const out = await fetchSearchSamples({
      source: 'amazon-us',
      url: 'https://www.amazon.com/s?k=foo',
    });
    expect(out.samples).toEqual([]);
    expect(out.warning).toContain('Amazon/Akamai');
    expect(fakeStructured).not.toHaveBeenCalled();
  });

  it('returns empty + warning on too-short response (likely blocked)', async () => {
    mockFetch(() => new Response('<html>tiny</html>', { status: 200 }));
    const out = await fetchSearchSamples({
      source: 'amazon-us',
      url: 'https://www.amazon.com/s?k=foo',
    });
    expect(out.samples).toEqual([]);
    expect(out.warning).toContain('过短');
    expect(fakeStructured).not.toHaveBeenCalled();
  });

  it('parses HTML through the LLM and returns structured samples', async () => {
    // Build a "long enough" body so the size guard passes.
    const padding = 'x'.repeat(5000);
    const html = `<html><body>${padding}<h2>Travel Mug</h2><span>$19.99</span></body></html>`;
    mockFetch(() => new Response(html, { status: 200 }));
    fakeStructured.mockResolvedValueOnce({
      samples: [
        { title: 'Premium Travel Mug 16oz', price: '$19.99', rating: '4.6', reviews: '1,234' },
        { title: 'Eco Stainless Steel Tumbler', price: '$24.50', rating: '4.7', reviews: '8,901' },
      ],
    });

    const out = await fetchSearchSamples({
      source: 'amazon-us',
      url: 'https://www.amazon.com/s?k=mug',
      maxSamples: 5,
    });

    expect(out.samples).toHaveLength(2);
    expect(out.samples[0].title).toBe('Premium Travel Mug 16oz');
    expect(out.samples[0].price).toBe('$19.99');
    expect(out.warning).toBeUndefined();
    expect(fakeStructured).toHaveBeenCalledTimes(1);
  });

  it('extracts Amazon search result cards deterministically before using the LLM', async () => {
    const padding = 'x'.repeat(5000);
    mockFetch((url) => {
      if (url.includes('/dp/B0D9WVKXLK')) {
        return new Response('<html>detail short</html>', { status: 200 });
      }
      return new Response(
        `<html><body>${padding}
          <div role="listitem" data-asin="B0D9WVKXLK" data-index="2" data-component-type="s-search-result" class="s-result-item s-asin">
            <a class="a-link-normal s-line-clamp-2" href="/-/zh/dp/B0D9WVKXLK/ref=sr_1_1">
              <h2 aria-label="Oura 戒指 4 - 金色" class="a-size-medium"><span>Oura 戒指 4 - 金色</span></h2>
            </a>
            <img class="s-image" src="https://m.media-amazon.com/images/I/ring.jpg" alt="Oura 戒指 4 - 金色">
            <span aria-hidden="true" class="a-size-small a-color-base">4.0</span>
            <a aria-label="7,468 评级" href="/dp/B0D9WVKXLK#customerReviews"><span>(7468)</span></a>
            <span class="a-offscreen">JPY&nbsp;78,197</span>
            <span>1K+ bought in past month</span>
          </div>
        </body></html>`,
        { status: 200 },
      );
    });

    const out = await fetchSearchSamples({
      source: 'amazon-us',
      url: 'https://www.amazon.com/s?k=ring',
      maxSamples: 5,
    });

    expect(out.samples[0]).toMatchObject({
      title: 'Oura 戒指 4 - 金色',
      price: 'JPY 78,197',
      rating: '4.0',
      reviews: '7,468',
      sales: '1K+ bought in past month',
      url: 'https://www.amazon.com/dp/B0D9WVKXLK',
      imageUrl: 'https://m.media-amazon.com/images/I/ring.jpg',
    });
    expect(fakeStructured).not.toHaveBeenCalled();
  });

  it('extracts Etsy listing cards deterministically before using the LLM', async () => {
    const padding = 'x'.repeat(5000);
    mockFetch((url) => {
      if (url.includes('/listing/123456789')) {
        return new Response('<html>detail short</html>', { status: 200 });
      }
      return new Response(
        `<html><body>${padding}
          <ol>
            <li class="wt-list-unstyled">
              <a href="/listing/123456789/personalized-pet-sofa-bed">
                <h3>Personalized Pet Sofa Bed for Small Dogs</h3>
              </a>
              <img
                src="https://i.etsystatic.com/12345/r/il/abc123/6000000000/il_340x270.6000000000_abcd.jpg?width=340"
                srcset="https://i.etsystatic.com/12345/r/il/abc123/6000000000/il_340x270.6000000000_abcd.jpg?width=340 1x, https://i.etsystatic.com/12345/r/il/abc123/6000000000/il_794xN.6000000000_abcd.jpg?width=794 2x, https://i.etsystatic.com/12345/r/il/abc123/6000000000/il_fullxfull.6000000000_abcd.jpg 3x"
                alt="Personalized Pet Sofa Bed for Small Dogs"
              >
              <span class="currency-symbol">$</span><span class="currency-value">49.99</span>
              <span aria-label="4.9 out of 5 stars">4.9</span>
              <span>(398)</span>
              <span>Bestseller</span>
            </li>
          </ol>
        </body></html>`,
        { status: 200 },
      );
    });

    const out = await fetchSearchSamples({
      source: 'etsy',
      url: 'https://www.etsy.com/search?q=pet%20sofa',
      maxSamples: 5,
    });

    expect(out.samples[0]).toMatchObject({
      title: 'Personalized Pet Sofa Bed for Small Dogs',
      productId: '123456789',
      price: '$49.99',
      rating: '4.9',
      reviews: '398',
      url: 'https://www.etsy.com/listing/123456789/personalized-pet-sofa-bed',
      imageUrl:
        'https://i.etsystatic.com/12345/r/il/abc123/6000000000/il_340x270.6000000000_abcd.jpg?width=340',
      badges: ['Bestseller'],
      heatLevel: '强',
      heatConfidence: '高',
    });
    expect(out.samples[0].imageUrls).toEqual([
      'https://i.etsystatic.com/12345/r/il/abc123/6000000000/il_340x270.6000000000_abcd.jpg?width=340',
    ]);
    expect(out.samples[0].heatScore).toBeGreaterThanOrEqual(70);
    expect(out.samples[0].heatReasons).toContain('Etsy 显示 Bestseller');
    expect(fakeStructured).not.toHaveBeenCalled();
  });

  it('keeps the full Etsy listing card when the first listing link is the image link', async () => {
    const html = `
      <html><head>
        <script type="application/ld+json">
          {"@context":"https://schema.org","@type":"ItemList","itemListElement":[
            {"@type":"ListItem","position":1,"item":{"@type":"Product","image":"https://i.etsystatic.com/63614474/r/il/24908e/7889342431/il_fullxfull.7889342431_ni5w.jpg","name":"Calming Plush Pet Sofa Bed for Dogs & Cats","url":"https://www.etsy.com/listing/4477469671/calming-plush-pet-sofa-bed-for-dogs-cats","brand":{"@type":"Brand","name":"VelvetTailCo"},"offers":{"@type":"Offer","price":"52.57","priceCurrency":"USD"}}}
          ]}
        </script>
      </head><body>
        <div class="js-merch-stash-check-listing listing-card-experimental-style"
          data-palette-listing-id="4477469671"
          data-shop-id="63614474"
          data-listing-id="4477469671"
          data-page-type="search"
          data-behat-listing-card=""
          data-listing-card-v2="">
          <a class="v2-listing-card__img" data-listing-id="4477469671"
            href="https://www.etsy.com/listing/4477469671/calming-plush-pet-sofa-bed-for-dogs-cats?ref=search_grid-1-1"
            aria-label="Calming Plush Pet Sofa Bed for Dogs & Cats, Calming Dog Couch Bed">
            <img
              src="https://i.etsystatic.com/63614474/c/1432/1432/295/397/il/24908e/7889342431/il_300x300.7889342431_ni5w.jpg"
              data-preload-lp-src="https://i.etsystatic.com/63614474/r/il/24908e/7889342431/il_794xN.7889342431_ni5w.jpg"
              data-preload-lp-srcset="https://i.etsystatic.com/63614474/r/il/24908e/7889342431/il_794xN.7889342431_ni5w.jpg 1x, https://i.etsystatic.com/63614474/r/il/24908e/7889342431/il_1588xN.7889342431_ni5w.jpg 2x"
              srcset="https://i.etsystatic.com/63614474/c/1432/1432/295/397/il/24908e/7889342431/il_255x340.7889342431_ni5w.jpg 255w, https://i.etsystatic.com/63614474/c/1432/1432/295/397/il/24908e/7889342431/il_510x680.7889342431_ni5w.jpg 510w"
              alt="Calming Plush Pet Sofa Bed for Dogs & Cats, Calming Dog Couch Bed" />
          </a>
          <a href="https://www.etsy.com/listing/4477469671/calming-plush-pet-sofa-bed-for-dogs-cats?ref=search_grid-1-1">
            <h3>Calming Plush Pet Sofa Bed for Dogs & Cats, Calming Dog Couch Bed</h3>
          </a>
          <div role="img" aria-label="4.9 star rating with 715 reviews"></div>
          <span data-seller-name-link="">VelvetTailCo</span>
          <span class="currency-symbol">$</span><span class="currency-value">52.57</span>
          <span>Popular now</span>
        </div>
      </body></html>`;

    mockFetch((url) => {
      if (url.includes('/listing/4477469671')) {
        return new Response('<html>tiny detail</html>', { status: 200 });
      }
      return new Response(html, { status: 200 });
    });

    const out = await fetchSearchSamples({
      source: 'etsy',
      url: 'https://www.etsy.com/search?q=pet%20sofa',
      maxSamples: 5,
    });

    expect(out.samples[0]).toMatchObject({
      title: 'Calming Plush Pet Sofa Bed for Dogs & Cats, Calming Dog Couch Bed',
      productId: '4477469671',
      price: '$52.57',
      rating: '4.9',
      reviews: '715',
      brand: 'VelvetTailCo',
      badges: ['Popular now'],
    });
    expect(out.samples[0].imageUrls).toEqual([
      'https://i.etsystatic.com/63614474/r/il/24908e/7889342431/il_794xN.7889342431_ni5w.jpg',
    ]);
    expect(fakeStructured).not.toHaveBeenCalled();
  });

  it('does not reject an Etsy detail page just because captcha text appears in scripts when product evidence is present', async () => {
    const padding = 'x'.repeat(2000);
    const gallery = [
      'https://i.etsystatic.com/111/r/il/aaaa/6000000001/il_794xN.6000000001_abcd.jpg',
      'https://i.etsystatic.com/111/r/il/bbbb/6000000002/il_794xN.6000000002_efgh.jpg',
      'https://i.etsystatic.com/111/r/il/cccc/6000000003/il_794xN.6000000003_ijkl.jpg',
    ];
    mockFetch((url) => {
      if (url.includes('/listing/4477469671')) {
        return new Response(
          `<html><head>
            <title>Calming Plush Pet Sofa Bed for Dogs & Cats - Etsy</title>
            <script>window.botCopy = "captcha robot challenge copy for defensive runtime";</script>
            <script type="application/ld+json">
              {"@context":"https://schema.org","@type":"Product","name":"Calming Plush Pet Sofa Bed for Dogs & Cats","image":${JSON.stringify(gallery)},"offers":{"@type":"Offer","price":"52.57","priceCurrency":"USD"}}
            </script>
          </head><body>${padding}
            <h1>Calming Plush Pet Sofa Bed for Dogs & Cats</h1>
            ${gallery.map((img) => `<img src="${img}" />`).join('')}
          </body></html>`,
          { status: 200 },
        );
      }
      return new Response(
        `<html><body>${padding}
          <div data-behat-listing-card="" data-palette-listing-id="4477469671" data-listing-id="4477469671">
            <a href="https://www.etsy.com/listing/4477469671/calming-plush-pet-sofa-bed-for-dogs-cats">
              <h3>Calming Plush Pet Sofa Bed for Dogs & Cats</h3>
            </a>
            <img src="${gallery[0]}" alt="Calming Plush Pet Sofa Bed for Dogs & Cats" />
            <span class="currency-symbol">$</span><span class="currency-value">52.57</span>
          </div>
        </body></html>`,
        { status: 200 },
      );
    });
    fakeStructured.mockRejectedValueOnce(new Error('detail LLM unavailable'));

    const out = await fetchSearchSamples({
      source: 'etsy',
      url: 'https://www.etsy.com/search?q=pet%20sofa',
      maxSamples: 5,
    });

    expect(out.detailWarnings).toBeUndefined();
    expect(out.details).toHaveLength(1);
    expect([out.details[0].imageUrl, ...(out.details[0].galleryImageUrls ?? [])]).toEqual(gallery);
  });

  it('opens extracted product URLs and stores factual product details', async () => {
    const padding = 'x'.repeat(5000);
    mockFetch((url) => {
      if (url.includes('/dp/B001')) {
        return new Response(
          `<html><body>${padding}<h1>Premium Travel Mug 16oz</h1><ul><li>Leak proof lid</li></ul></body></html>`,
          { status: 200, headers: { 'content-type': 'text/html' } },
        );
      }
      return new Response(
        `<html><body>${padding}<a href="/dp/B001">Premium Travel Mug 16oz</a></body></html>`,
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    });
    fakeStructured
      .mockResolvedValueOnce({
        samples: [
          {
            title: 'Premium Travel Mug 16oz',
            price: '$19.99',
            rating: '4.6',
            reviews: '1,234',
            url: '/dp/B001',
            image_url: '/images/mug.jpg',
          },
        ],
      })
      .mockResolvedValueOnce({
        title: 'Premium Travel Mug 16oz',
        price: '$19.99',
        rating: '4.6',
        reviews: '1,234',
        brand: 'Acme',
        availability: 'In stock',
        bullet_points: ['Leak proof lid', 'Fits car cup holders'],
        description: 'Insulated travel mug.',
        image_url: '/images/mug-hero.jpg',
        image_urls: ['/assets/runtime.js?AUIClients/AmazonUI', '/images/mug-side.jpg'],
      });

    const out = await fetchSearchSamples({
      source: 'amazon-us',
      url: 'https://www.amazon.com/s?k=mug',
      maxSamples: 5,
    });

    expect(out.samples[0].url).toBe('https://www.amazon.com/dp/B001');
    expect(out.samples[0].imageUrl).toBe('https://www.amazon.com/images/mug.jpg');
    expect(out.details).toHaveLength(1);
    expect(out.details[0]).toMatchObject({
      title: 'Premium Travel Mug 16oz',
      url: 'https://www.amazon.com/dp/B001',
      brand: 'Acme',
      bulletPoints: ['Leak proof lid', 'Fits car cup holders'],
      imageUrl: 'https://www.amazon.com/images/mug-hero.jpg',
      fetchedVia: 'server-fetch',
    });
    expect(out.details[0].galleryImageUrls).toContain('https://www.amazon.com/images/mug-side.jpg');
    expect(out.details[0].galleryImageUrls).not.toContain('https://www.amazon.com/assets/runtime.js?AUIClients/AmazonUI');
    expect(fakeStructured).toHaveBeenCalledTimes(2);
  });

  it('respects maxSamples cap', async () => {
    const padding = 'x'.repeat(5000);
    const html = `<html><body>${padding}<h2>X</h2></body></html>`;
    mockFetch(() => new Response(html, { status: 200 }));
    fakeStructured.mockResolvedValueOnce({
      samples: Array.from({ length: 8 }, (_, i) => ({ title: `Item ${i}` })),
    });
    const out = await fetchSearchSamples({
      source: 'amazon-us',
      url: 'https://x',
      maxSamples: 3,
    });
    expect(out.samples).toHaveLength(3);
  });

  it('survives fetch throwing (network error / timeout)', async () => {
    mockFetch(() => {
      throw new Error('ECONNRESET');
    });
    const out = await fetchSearchSamples({
      source: 'amazon-us',
      url: 'https://www.amazon.com/s?k=foo',
    });
    expect(out.samples).toEqual([]);
    expect(out.warning).toContain('ECONNRESET');
  });

  it('survives LLM extraction error gracefully', async () => {
    const padding = 'x'.repeat(5000);
    const html = `<html><body>${padding}<h2>X</h2></body></html>`;
    mockFetch(() => new Response(html, { status: 200 }));
    fakeStructured.mockRejectedValueOnce(new Error('LLM down'));
    const out = await fetchSearchSamples({
      source: 'amazon-us',
      url: 'https://x',
    });
    expect(out.samples).toEqual([]);
    expect(out.warning).toContain('解析失败');
  });

  it('uses the configured Lumos browser context before server fetch when a store is provided', async () => {
    const db = setupDb();
    const store = createAppDataStore(db, APP_ID);
    setBrowserFetchSettings(store, {
      enabled: true,
      browserContextId: 'adspower:kabc123',
    });
    mockResolveBrowserBridgeRuntimeConfig.mockReturnValue({
      baseUrl: 'http://127.0.0.1:39000',
      token: 'token',
      source: 'env',
      browserContextId: 'adspower:kabc123',
    });
    const padding = 'x'.repeat(5000);
    mockPostToBrowserBridge.mockImplementation((_config, pathname) => {
      if (pathname === '/v1/pages/new') {
        return Promise.resolve({ ok: true, pageId: 'page-1' });
      }
      if (pathname === '/v1/pages/evaluate') {
        return Promise.resolve({
          ok: true,
          pageId: 'page-1',
          value: {
            url: 'https://www.amazon.com/s?k=mug',
            title: 'Amazon search',
            html: `<html><body>${padding}<h2>Browser Mug</h2></body></html>`,
          },
        });
      }
      if (pathname === '/v1/pages/close') {
        return Promise.resolve({ ok: true });
      }
      throw new Error(`unexpected bridge call ${pathname}`);
    });
    global.fetch = jest.fn(() => {
      throw new Error('server fetch should not run');
    }) as unknown as typeof fetch;
    fakeStructured.mockResolvedValueOnce({
      samples: [{ title: 'Browser Mug', price: '$19.99' }],
    });

    try {
      const out = await fetchSearchSamples({
        source: 'amazon-us',
        url: 'https://www.amazon.com/s?k=mug',
        maxSamples: 5,
        store,
      });

      expect(out.samples[0].title).toBe('Browser Mug');
      expect(mockResolveBrowserBridgeRuntimeConfig).toHaveBeenCalledWith({
        browserContextId: 'adspower:kabc123',
        lockOwnerId: 'ecommerce-discover',
      });
      expect(mockPostToBrowserBridge).toHaveBeenCalledWith(
        expect.objectContaining({ browserContextId: 'adspower:kabc123' }),
        '/v1/pages/new',
        { url: 'https://www.amazon.com/s?k=mug', background: true },
        expect.objectContaining({ timeoutMs: 90_000 }),
      );
    } finally {
      db.close();
    }
  });

  it('keeps Etsy gallery images captured from the rendered browser DOM', async () => {
    const db = setupDb();
    const store = createAppDataStore(db, APP_ID);
    setBrowserFetchSettings(store, {
      enabled: true,
      browserContextId: 'adspower:kabc123',
    });
    mockResolveBrowserBridgeRuntimeConfig.mockReturnValue({
      baseUrl: 'http://127.0.0.1:39000',
      token: 'token',
      source: 'env',
      browserContextId: 'adspower:kabc123',
    });
    let newPageCount = 0;
    let detailEvaluateCount = 0;
    const padding = 'x'.repeat(2000);
    const gallery = [
      'https://i.etsystatic.com/111/r/il/aaaa/6000000001/il_794xN.6000000001_abcd.jpg',
      'https://i.etsystatic.com/111/r/il/bbbb/6000000002/il_794xN.6000000002_efgh.jpg',
      'https://i.etsystatic.com/111/r/il/cccc/6000000003/il_794xN.6000000003_ijkl.jpg',
      'https://i.etsystatic.com/111/r/il/dddd/6000000004/il_794xN.6000000004_mnop.jpg',
    ];
    mockPostToBrowserBridge.mockImplementation((_config, pathname, body) => {
      if (pathname === '/v1/pages/new') {
        newPageCount += 1;
        return Promise.resolve({ ok: true, pageId: `page-${newPageCount}` });
      }
      if (pathname === '/v1/pages/evaluate') {
        if ((body as { pageId?: string }).pageId === 'page-1') {
          return Promise.resolve({
            ok: true,
            pageId: 'page-1',
            value: {
              url: 'https://www.etsy.com/search?q=pet%20sofa',
              title: 'Pet sofa - Etsy',
              readyState: 'complete',
              bodyHtmlLength: 5000,
              bodyTextLength: 1000,
              bodyChildCount: 1,
              productImageUrls: [gallery[0]],
              html: `<html><body>${padding}
                <div data-behat-listing-card="" data-palette-listing-id="4477469671" data-listing-id="4477469671">
                  <a href="https://www.etsy.com/listing/4477469671/calming-plush-pet-sofa-bed-for-dogs-cats">
                    <h3>Calming Plush Pet Sofa Bed for Dogs & Cats</h3>
                  </a>
                  <img src="${gallery[0]}" alt="Calming Plush Pet Sofa Bed for Dogs & Cats" />
                  <span class="currency-symbol">$</span><span class="currency-value">52.57</span>
                </div>
              </body></html>`,
            },
          });
        }
        if ((body as { pageId?: string }).pageId === 'page-2') {
          detailEvaluateCount += 1;
          if (detailEvaluateCount === 1) {
            return Promise.resolve({
              ok: true,
              pageId: 'page-2',
              value: {
                url: 'https://www.etsy.com/listing/4477469671/calming-plush-pet-sofa-bed-for-dogs-cats',
                title: 'Calming Plush Pet Sofa Bed for Dogs & Cats - Etsy',
                readyState: 'complete',
                bodyHtmlLength: 4000,
                bodyTextLength: 900,
                bodyChildCount: 1,
                productImageUrls: [gallery[0]],
                html: `<html><body>${padding}<h1>Calming Plush Pet Sofa Bed for Dogs & Cats</h1><img src="${gallery[0]}" /></body></html>`,
              },
            });
          }
        }
        return Promise.resolve({
          ok: true,
          pageId: 'page-2',
          value: {
            url: 'https://www.etsy.com/listing/4477469671/calming-plush-pet-sofa-bed-for-dogs-cats',
            title: 'Calming Plush Pet Sofa Bed for Dogs & Cats - Etsy',
            readyState: 'complete',
            bodyHtmlLength: 4000,
            bodyTextLength: 900,
            bodyChildCount: 1,
            productImageUrls: gallery,
            html: `<html><body>${padding}<h1>Calming Plush Pet Sofa Bed for Dogs & Cats</h1><img src="${gallery[0]}" /></body></html>`,
          },
        });
      }
      if (pathname === '/v1/pages/close') {
        return Promise.resolve({ ok: true });
      }
      throw new Error(`unexpected bridge call ${pathname}`);
    });
    global.fetch = jest.fn(() => {
      throw new Error('server fetch should not run');
    }) as unknown as typeof fetch;

    try {
      const out = await fetchSearchSamples({
        source: 'etsy',
        url: 'https://www.etsy.com/search?q=pet%20sofa',
        maxSamples: 5,
        store,
      });

      expect(out.details).toHaveLength(1);
      expect([out.details[0].imageUrl, ...(out.details[0].galleryImageUrls ?? [])]).toEqual(gallery);
      expect(detailEvaluateCount).toBe(2);
      expect(mockPostToBrowserBridge).toHaveBeenCalledWith(
        expect.objectContaining({ browserContextId: 'adspower:kabc123' }),
        '/v1/pages/close',
        { pageId: 'page-1', background: true },
        expect.objectContaining({ timeoutMs: 10_000 }),
      );
      expect(mockPostToBrowserBridge).toHaveBeenCalledWith(
        expect.objectContaining({ browserContextId: 'adspower:kabc123' }),
        '/v1/pages/close',
        { pageId: 'page-2', background: true },
        expect.objectContaining({ timeoutMs: 10_000 }),
      );
    } finally {
      db.close();
    }
  });

  it('does not treat a large script-only browser shell as a rendered marketplace page', async () => {
    const db = setupDb();
    const store = createAppDataStore(db, APP_ID);
    setBrowserFetchSettings(store, {
      enabled: true,
      browserContextId: 'adspower:kabc123',
    });
    mockResolveBrowserBridgeRuntimeConfig.mockReturnValue({
      baseUrl: 'http://127.0.0.1:39000',
      token: 'token',
      source: 'env',
      browserContextId: 'adspower:kabc123',
    });
    const padding = 'x'.repeat(5000);
    let evaluateCount = 0;
    mockPostToBrowserBridge.mockImplementation((_config, pathname) => {
      if (pathname === '/v1/pages/new') {
        return Promise.resolve({ ok: true, pageId: 'page-1' });
      }
      if (pathname === '/v1/pages/evaluate') {
        evaluateCount += 1;
        if (evaluateCount === 1) {
          return Promise.resolve({
            ok: true,
            pageId: 'page-1',
            value: {
              url: 'https://www.amazon.com/s?k=mug',
              title: 'Amazon shell',
              readyState: 'complete',
              bodyHtmlLength: 0,
              bodyTextLength: 0,
              bodyChildCount: 0,
              html: `<html><head>${'<script></script>'.repeat(4000)}</head></html>`,
            },
          });
        }
        return Promise.resolve({
          ok: true,
          pageId: 'page-1',
          value: {
            url: 'https://www.amazon.com/s?k=mug',
            title: 'Amazon search',
            readyState: 'complete',
            bodyHtmlLength: padding.length + 24,
            bodyTextLength: padding.length + 11,
            bodyChildCount: 1,
            html: `<html><body>${padding}<h2>Browser Mug</h2></body></html>`,
          },
        });
      }
      if (pathname === '/v1/pages/close') {
        return Promise.resolve({ ok: true });
      }
      throw new Error(`unexpected bridge call ${pathname}`);
    });
    global.fetch = jest.fn(() => {
      throw new Error('server fetch should not run');
    }) as unknown as typeof fetch;
    fakeStructured.mockResolvedValueOnce({
      samples: [{ title: 'Browser Mug', price: '$19.99' }],
    });

    try {
      const out = await fetchSearchSamples({
        source: 'amazon-us',
        url: 'https://www.amazon.com/s?k=mug',
        maxSamples: 5,
        store,
      });

      expect(evaluateCount).toBeGreaterThanOrEqual(2);
      expect(out.samples[0].title).toBe('Browser Mug');
    } finally {
      db.close();
    }
  });
});
