import {
  extractRenderData,
  extractVideoFromRenderData,
  extractVideoMetadataFromHtml,
  fetchVideoMetadata,
} from '../scraper';

const FIXTURE_RENDER_DATA = {
  app: {
    loaderData: {
      'video_(id)/page': {
        videoInfoRes: {
          item_list: [
            {
              aweme_id: '7321234567890123456',
              desc: 'Claude API 实战分享',
              duration: 1800000,
              video: {
                cover: {
                  url_list: [
                    'https://p.douyinpic.com/cover-xxx.jpeg',
                    'https://p2.douyinpic.com/cover-xxx.jpeg',
                  ],
                },
                duration: 1800000,
              },
              author: {
                nickname: 'AI 实践者',
                sec_uid: 'MS4wLjABAAAAabcDEF1234567890ZZ',
              },
              caption_infos: [
                { url: 'https://lf3-cdn-tos.bytescm.com/captions/zh-CN.vtt' },
              ],
            },
          ],
        },
      },
    },
  },
};

const FIXTURE_HTML = `<!doctype html>
<html>
  <head><title>Douyin</title></head>
  <body>
    <script id="RENDER_DATA" type="application/json">${encodeURIComponent(
      JSON.stringify(FIXTURE_RENDER_DATA),
    )}</script>
  </body>
</html>`;

describe('extractRenderData', () => {
  it('decodes URL-encoded RENDER_DATA into a JSON object', () => {
    const data = extractRenderData(FIXTURE_HTML);
    expect(data).toBeTruthy();
    expect(typeof data).toBe('object');
  });

  it('returns null when the script is missing', () => {
    expect(extractRenderData('<html><body>no data</body></html>')).toBeNull();
  });

  it('returns null when payload is not URL-encoded JSON', () => {
    const html = `<script id="RENDER_DATA" type="application/json">not%20valid%20json</script>`;
    expect(extractRenderData(html)).toBeNull();
  });

  it('also handles a plain JSON payload (no URL-encoding)', () => {
    const html = `<script id="RENDER_DATA" type="application/json">{"hello":"world"}</script>`;
    const data = extractRenderData(html);
    expect(data).toEqual({ hello: 'world' });
  });

  it('extracts current window._ROUTER_DATA share-page JSON', () => {
    const html = `<script>window._ROUTER_DATA = ${JSON.stringify({
      loaderData: {
        'video_(id)/page': {
          videoInfoRes: {
            item_list: [{
              aweme_id: '7321234567890123456',
              desc: 'new ssr',
              video: { play_addr: { url_list: ['https://aweme.snssdk.com/aweme/v1/playwm/?video_id=x'] } },
            }],
          },
        },
      },
    })}</script>`;

    const data = extractRenderData(html);
    const meta = extractVideoFromRenderData(data, '7321234567890123456');

    expect(meta?.title).toBe('new ssr');
    expect(meta?.playAddrUrls).toEqual([
      'https://aweme.snssdk.com/aweme/v1/playwm/?video_id=x',
    ]);
  });
});

describe('extractVideoFromRenderData', () => {
  it('finds the aweme node by id and pulls title/cover/duration/author', () => {
    const data = extractRenderData(FIXTURE_HTML);
    const meta = extractVideoFromRenderData(data, '7321234567890123456');
    expect(meta).toEqual({
      awemeId: '7321234567890123456',
      title: 'Claude API 实战分享',
      cover: 'https://p.douyinpic.com/cover-xxx.jpeg',
      duration: 1800,
      authorNickname: 'AI 实践者',
      authorSecUid: 'MS4wLjABAAAAabcDEF1234567890ZZ',
      nativeSubtitleUrls: ['https://lf3-cdn-tos.bytescm.com/captions/zh-CN.vtt'],
      playAddrUrls: [],
    });
  });

  it('returns null when the aweme id is not present in the tree', () => {
    const data = extractRenderData(FIXTURE_HTML);
    expect(extractVideoFromRenderData(data, 'nonexistent-id')).toBeNull();
  });

  it('handles the camelCase awemeId shape used by some pages', () => {
    const data = {
      videoInfoRes: { item_list: [{ awemeId: '999', desc: 't', author: {} }] },
    };
    const meta = extractVideoFromRenderData(data, '999');
    expect(meta?.title).toBe('t');
    expect(meta?.duration).toBeNull();
  });

  it('collects native subtitle URLs from alternate caption shapes', () => {
    const data = {
      videoInfoRes: {
        item_list: [
          {
            aweme_id: 'caption-alt',
            desc: 'with captions',
            video: {
              caption_infos: [
                { url_list: ['https://cdn.example.com/a.vtt', 'https://cdn.example.com/b.vtt'] },
                { captionUrl: 'https://cdn.example.com/c.json' },
              ],
            },
            caption: {
              caption_infos: [{ subtitle_url: 'https://cdn.example.com/b.vtt' }],
            },
          },
        ],
      },
    };
    const meta = extractVideoFromRenderData(data, 'caption-alt');
    expect(meta?.nativeSubtitleUrls).toHaveLength(3);
    expect(meta?.nativeSubtitleUrls).toEqual(expect.arrayContaining([
      'https://cdn.example.com/a.vtt',
      'https://cdn.example.com/b.vtt',
      'https://cdn.example.com/c.json',
    ]));
  });
});

describe('extractVideoMetadataFromHtml', () => {
  it('falls back to share-page title, description and poster when JSON injection is missing', () => {
    const html = [
      '<html><head>',
      '<title data-react-helmet="true">你对我的好我一直记得#双子座 - 抖音</title>',
      '<meta name="description" content="你对我的好我一直记得#双子座 - 萧萧不吃辣于20240524发布在抖音，已经收获了315418个喜欢，来抖音，记录美好生活！"/>',
      '</head><body>',
      '<img class="poster" src="https://p3-sign.douyinpic.com/poster.webp?x=1&amp;y=2" />',
      '</body></html>',
    ].join('');

    expect(extractVideoMetadataFromHtml(html, '7372484719365098803')).toEqual({
      awemeId: '7372484719365098803',
      title: '你对我的好我一直记得#双子座',
      cover: 'https://p3-sign.douyinpic.com/poster.webp?x=1&y=2',
      duration: null,
      authorNickname: '萧萧不吃辣',
      authorSecUid: null,
      nativeSubtitleUrls: [],
      playAddrUrls: [],
    });
  });
});

describe('fetchVideoMetadata', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('uses HTML metadata fallback when the share page has no JSON injection point', async () => {
    const html = [
      '<html><head>',
      '<title>王自如相关视频 - 抖音</title>',
      '<meta name="description" content="王自如相关视频 - 科技博主于20260515发布在抖音，来抖音，记录美好生活！"/>',
      '</head><body>',
      '<img class="poster" src="https://p3-sign.douyinpic.com/wang.webp" />',
      '</body></html>',
    ].join('');
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response(html, { status: 200 })) as unknown as typeof globalThis.fetch;

    const outcome = await fetchVideoMetadata('7372484719365098803');

    expect(outcome).toEqual({
      ok: true,
      metadata: expect.objectContaining({
        awemeId: '7372484719365098803',
        title: '王自如相关视频',
        cover: 'https://p3-sign.douyinpic.com/wang.webp',
        authorNickname: '科技博主',
      }),
    });
  });
});
