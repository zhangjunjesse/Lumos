// 图文解析(#55)。视频和图文是同一个 aweme 结构,区别只在挂什么字段,
// 所以「怎么认出类型」是这层的核心,单独锁死。

import {
  detectAwemeContentKind,
  extractNoteFromRenderData,
} from '../note-scraper';
import type { MaybeAweme } from '../scraper';

const NOTE_ID = '7636725615005044008';

// 这个形状照着真实数据造(2026-07-29 抓的 issue #55 原帖):
// aweme_type 是 2 而不是网传的 68,而且**图文同样带 video.play_addr** ——
// 两个"想当然"的判据在真实数据上都不成立,所以这里必须原样复现,否则测试
// 会替一个错误的假设背书。
function noteNode(overrides: Partial<MaybeAweme> = {}): MaybeAweme {
  return {
    aweme_id: NOTE_ID,
    aweme_type: 2,
    desc: 'claude code上下文压缩有几层？',
    images: [
      { url_list: ['https://p.douyin.com/img-1.jpeg', 'https://backup/img-1.jpeg'] },
      { url_list: ['https://p.douyin.com/img-2.jpeg'] },
    ],
    video: { play_addr: { url_list: ['https://aweme.snssdk.com/play/note-slideshow'] } },
    author: { nickname: '算法欧巴', sec_uid: 'MS4wLjABAAAAabcDEF1234567890ZZ' },
    ...overrides,
  };
}

function videoNode(): MaybeAweme {
  return {
    aweme_id: '7321234567890123456',
    desc: '一条视频',
    video: { play_addr: { url_list: ['https://v.douyin.com/play.mp4'] } },
  };
}

describe('detectAwemeContentKind', () => {
  // 这条最关键:真实图文自带 play_addr。判据顺序一旦调成先看 play_addr,
  // 线上每条图文都会被认成视频,然后去抓根本不存在的字幕。
  it('图文自带 play_addr 时仍判成图文(images 优先)', () => {
    const node = noteNode();
    expect(node.video?.play_addr).toBeDefined();
    expect(detectAwemeContentKind(node)).toBe('note');
  });

  it('不依赖 aweme_type —— 实测值是 2,网传的 68 靠不住', () => {
    expect(detectAwemeContentKind(noteNode({ aweme_type: 68 }))).toBe('note');
    expect(detectAwemeContentKind(noteNode({ aweme_type: 2 }))).toBe('note');
    const noCode = noteNode();
    delete noCode.aweme_type;
    expect(detectAwemeContentKind(noCode)).toBe('note');
  });

  it('只有播放地址、没有图片的认成视频', () => {
    expect(detectAwemeContentKind(videoNode())).toBe('video');
  });

  // 旧代码把「没判过」和「是视频」混成一件事,图文的裸 ID 会被静默送进视频链路。
  it('两样特征都没有时返回 null —— 不猜', () => {
    expect(detectAwemeContentKind({ aweme_id: NOTE_ID, desc: '只有标题' })).toBeNull();
  });

  it('images 是空数组时不算图文', () => {
    expect(detectAwemeContentKind(noteNode({ images: [] }))).toBe('video');
  });
});

describe('extractNoteFromRenderData', () => {
  const data = { some: { nested: { aweme: noteNode() } } };

  it('从嵌套 SSR 数据里挖出图文', () => {
    const meta = extractNoteFromRenderData(data, NOTE_ID);
    expect(meta).toMatchObject({
      awemeId: NOTE_ID,
      title: 'claude code上下文压缩有几层？',
      authorNickname: '算法欧巴',
      authorSecUid: 'MS4wLjABAAAAabcDEF1234567890ZZ',
    });
  });

  it('图片按顺序取,每张只取第一个可用直链', () => {
    const meta = extractNoteFromRenderData(data, NOTE_ID);
    expect(meta?.imageUrls).toEqual([
      'https://p.douyin.com/img-1.jpeg',
      'https://p.douyin.com/img-2.jpeg',
    ]);
  });

  it('没有封面字段时拿第一张图当封面', () => {
    const meta = extractNoteFromRenderData(data, NOTE_ID);
    expect(meta?.cover).toBe('https://p.douyin.com/img-1.jpeg');
  });

  it('口播型图文能拿到音轨,好走和视频一样的转写', () => {
    const withMusic = {
      aweme: noteNode({
        music: { play_url: { url_list: ['https://p.douyin.com/audio.mp3'] } },
      }),
    };
    const meta = extractNoteFromRenderData(withMusic, NOTE_ID);
    expect(meta?.audioUrls).toEqual(['https://p.douyin.com/audio.mp3']);
  });

  it('找不到对应 aweme 时返回 null', () => {
    expect(extractNoteFromRenderData(data, '9999999999999999999')).toBeNull();
  });

  it('图片字段是纯字符串数组时也能吃下', () => {
    const plain = { aweme: noteNode({ images: ['https://p.douyin.com/plain.jpeg'] }) };
    expect(extractNoteFromRenderData(plain, NOTE_ID)?.imageUrls)
      .toEqual(['https://p.douyin.com/plain.jpeg']);
  });
});
