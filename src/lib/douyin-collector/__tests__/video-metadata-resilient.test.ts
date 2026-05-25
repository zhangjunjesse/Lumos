import { fetchVideoMetadataResilient } from '../video-metadata-resilient';
import type { ScrapeOutcome } from '../scraper';

const fetchVideoMetadataMock = jest.fn<Promise<ScrapeOutcome>, [string]>();

jest.mock('../scraper', () => {
  const actual = jest.requireActual('../scraper');
  return {
    ...actual,
    fetchVideoMetadata: (id: string) => fetchVideoMetadataMock(id),
  };
});

const META = {
  awemeId: '7',
  title: 'real',
  cover: 'https://c/x.jpg',
  duration: 12,
  authorNickname: '博主',
  authorSecUid: 'sec',
  nativeSubtitleUrls: [],
  playAddrUrls: [],
};

beforeEach(() => {
  fetchVideoMetadataMock.mockReset();
});

describe('fetchVideoMetadataResilient', () => {
  it('returns the anonymous result unchanged on success WITH media URLs (no browser hop)', async () => {
    const withMedia = { ...META, playAddrUrls: ['https://v.cdn/x.mp4'] };
    fetchVideoMetadataMock.mockResolvedValue({ ok: true, metadata: withMedia });
    const out = await fetchVideoMetadataResilient('7');
    expect(out).toEqual({ ok: true, metadata: withMedia });
    expect(fetchVideoMetadataMock).toHaveBeenCalledTimes(1);
  });

  it('on half-skeleton (ok=true but no play_addr / native subtitle): falls into browser fallback', async () => {
    // 抖音对部分匿名请求返"半骨架": title/author/cover 有,但 play_addr/原生字幕
    // 都空。下游 transcribe 必然失败,resilient 应当继续走 layer-2/3 兜底拿真链接。
    fetchVideoMetadataMock.mockResolvedValue({ ok: true, metadata: META });
    const out = await fetchVideoMetadataResilient('7');
    expect(out.ok).toBe(false);
    // 测试环境下 browser bridge 短路,reason 会含半骨架描述
    if ('reason' in out) {
      expect(out.reason).toMatch(/半骨架|play_addr|原生字幕/);
    }
  });

  it('does NOT retry via browser for a genuinely gone video (phase=extract)', async () => {
    fetchVideoMetadataMock.mockResolvedValue({
      ok: false,
      phase: 'extract',
      reason: '视频已删除',
    });
    const out = await fetchVideoMetadataResilient('7');
    expect(out).toEqual({ ok: false, phase: 'extract', reason: '视频已删除' });
  });

  it('on risk skeleton, falls back to browser and surfaces both causes (test-env short-circuit)', async () => {
    fetchVideoMetadataMock.mockResolvedValue({
      ok: false,
      phase: 'risk',
      reason: '抖音 share 页被风控',
    });
    const out = await fetchVideoMetadataResilient('7');
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toContain('抖音 share 页被风控');
      expect(out.reason).toContain('登录浏览器重采');
    }
  });
});
