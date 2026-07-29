// 图文(note)抓取与解析(#55)。
//
// 图文和视频在抖音后端是同一种东西:同一套 aweme_id、同一个 share 页、同一份 SSR
// 数据。差别只在挂什么字段 —— 视频挂 video.play_addr,图文挂 images(口播型图文
// 还会挂 music.play_url)。所以这里只写"怎么认、怎么取",抓取和节点定位都复用
// scraper 那一套。
//
// 采集器以前只认 /video/,图文一律落进 unknown,下游于是回一句「需要抖音视频
// 链接」—— 把"这类内容不支持"说成了"你链接给错了"。

import type { DouyinContentKind } from './parse-input';
import {
  extractRenderData,
  fetchAwemeSharePage,
  findAwemeNode,
  pickString,
  pickStringList,
  pickText,
  uniqueStrings,
  type MaybeAweme,
} from './scraper';

// 类型判据只认 images,原因是拿真实数据核过的(2026-07-29,issue #55 里那条图文
// aweme_id=7636725615005044008):
//   - 它的 aweme_type 是 **2**,不是网上流传的 68 —— 类型码不可信;
//   - 它**同时带着 video.play_addr** —— 所以"有播放地址就是视频"也不成立。
// 唯一能把它和视频分开的就是顶层 images(实测 18 张,和它的 18 页图对应)。
// 因此下面的顺序不能调:images 必须先判,play_addr 只能兜底。

export interface ScrapedNoteMetadata {
  awemeId: string;
  /** 图文正文(desc)。图文的正文常常就是全部文字内容。 */
  title: string | null;
  cover: string | null;
  authorNickname: string | null;
  authorSecUid: string | null;
  /** 图片直链,按发布顺序。 */
  imageUrls: string[];
  /** 口播型图文的音轨;有值时可以走和视频一样的 ASR。 */
  audioUrls: string[];
}

export type NoteScrapeOutcome =
  | { ok: true; metadata: ScrapedNoteMetadata }
  | { ok: false; phase: 'http' | 'parse' | 'extract'; reason: string };

/** 图片数组的元素形如 { url_list: [...] };只取第一个可用直链。 */
function extractImageUrls(aweme: MaybeAweme): string[] {
  const buckets = [aweme.images, aweme.image_list, aweme.imageList];
  const urls: string[] = [];

  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const entry of bucket) {
      if (typeof entry === 'string') {
        urls.push(entry);
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as { url_list?: unknown; urlList?: unknown };
      const url = pickString(item.url_list) ?? pickString(item.urlList);
      if (url) urls.push(url);
    }
  }

  return uniqueStrings(urls);
}

function extractAudioUrls(aweme: MaybeAweme): string[] {
  return uniqueStrings([
    ...pickStringList(aweme.music?.play_url?.url_list),
    ...pickStringList(aweme.music?.play_url?.urlList),
    ...pickStringList(aweme.music?.playUrl?.url_list),
    ...pickStringList(aweme.music?.playUrl?.urlList),
  ]);
}

function hasVideoStream(aweme: MaybeAweme): boolean {
  return [
    aweme.video?.play_addr?.url_list,
    aweme.video?.play_addr?.urlList,
    aweme.video?.playAddr?.url_list,
    aweme.video?.playAddr?.urlList,
  ].some((list) => pickStringList(list).length > 0);
}

/**
 * 判断一个 aweme 节点是视频还是图文。
 *
 * 判不出来时返回 null —— 不猜。旧代码把"没判过"和"是视频"混成一件事,用户给
 * 一个图文的裸 ID 就会被静默送进视频链路。
 *
 * 顺序有讲究,见文件顶部的实测记录:图文也带 play_addr,先看 play_addr 会把
 * 图文认成视频。
 */
export function detectAwemeContentKind(aweme: MaybeAweme): DouyinContentKind | null {
  if (extractImageUrls(aweme).length > 0) return 'note';
  if (hasVideoStream(aweme)) return 'video';
  return null;
}

export function extractNoteFromRenderData(
  data: unknown,
  awemeId: string,
): ScrapedNoteMetadata | null {
  const aweme = findAwemeNode(data, awemeId);
  if (!aweme) return null;

  const imageUrls = extractImageUrls(aweme);
  const cover = pickString(aweme.cover?.url_list)
    ?? pickString(aweme.video?.cover?.url_list)
    ?? imageUrls[0]
    ?? null;

  return {
    awemeId,
    title: pickText(aweme.desc, aweme.title, aweme.share_info?.share_title, aweme.share_info?.shareTitle),
    cover,
    authorNickname: pickText(aweme.author?.nickname),
    authorSecUid: pickText(aweme.author?.sec_uid, aweme.author?.secUid),
    imageUrls,
    audioUrls: extractAudioUrls(aweme),
  };
}

/** 一条图文既没正文也没图片,等于什么都没抓到 —— 别拿空壳去污染库。 */
function isUsableNoteMetadata(metadata: ScrapedNoteMetadata | null): metadata is ScrapedNoteMetadata {
  if (!metadata) return false;
  return Boolean(metadata.title?.trim()) || metadata.imageUrls.length > 0;
}

export async function fetchNoteMetadata(awemeId: string): Promise<NoteScrapeOutcome> {
  const page = await fetchAwemeSharePage(awemeId);
  if (!page.ok) return page;

  const renderData = extractRenderData(page.html);
  if (!renderData) {
    return {
      ok: false,
      phase: 'parse',
      reason: '图文 share 页里没找到可解析的数据；可能命中风控或作品已删除。',
    };
  }

  const metadata = extractNoteFromRenderData(renderData, awemeId);
  if (!isUsableNoteMetadata(metadata)) {
    return {
      ok: false,
      phase: 'extract',
      reason: `图文 ${awemeId} 既没解析出正文也没解析出图片；可能已删除、仅粉丝可见或命中风控。`,
    };
  }

  return { ok: true, metadata };
}

/**
 * 探测一条作品到底是视频还是图文。
 *
 * 给裸 aweme_id 用 —— 光看 ID 认不出类型(两者共用同一套体系),只能抓一次详情。
 */
export async function fetchAwemeContentKind(
  awemeId: string,
): Promise<DouyinContentKind | null> {
  const page = await fetchAwemeSharePage(awemeId);
  if (!page.ok) return null;
  const renderData = extractRenderData(page.html);
  if (!renderData) return null;
  const aweme = findAwemeNode(renderData, awemeId);
  return aweme ? detectAwemeContentKind(aweme) : null;
}
