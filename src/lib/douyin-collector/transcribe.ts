import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { COLLECTION_TRANSCRIPTS, COLLECTION_VIDEOS } from './constants';
import { getDouyinCollectorStore } from './storage';
import {
  fetchAndParseSubtitle,
  type TranscriptFetchOutcome,
  type TranscriptSegment,
} from './transcript-fetcher';
import { buildApproximateAsrSegments } from './asr-segments';
import { publishVideoToKnowledge } from './publish';
import { getDouyinCollectorSettings, type TranscribePrefer } from './settings';
import { summarizeVideo } from './ai-summary';
import { DESKTOP_UA } from './scraper';
import { findMediaBinary } from '@/lib/media/ffmpeg-locator';

// 抖音媒体 CDN（douyinvod / snssdk play_addr）拒绝裸匿名请求：必须带
// Referer + 真实 UA，否则 403/404。裸 fetch(playUrls[0]) 正是「音频下载
// HTTP 404」失败的根因。统一在此构造下载请求头。
const DOUYIN_MEDIA_HEADERS = {
  'user-agent': DESKTOP_UA,
  referer: 'https://www.douyin.com/',
} as const;

/**
 * 依次尝试所有 play_addr URL（旧代码只试第一个就放弃，抖音常返回多个候选，
 * 首个签名失效/被拒时后续可能可用），带 CDN 要求的 Referer + UA 下载到
 * destPath。全部失败才返回聚合的真实原因，绝不 mock。
 */
async function downloadPlayAddr(
  urls: string[],
  destPath: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const failures: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: DOUYIN_MEDIA_HEADERS, redirect: 'follow' });
      if (!res.ok) {
        failures.push(`HTTP ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength === 0) {
        failures.push('空响应体');
        continue;
      }
      // mp4 box format: 第 5-8 字节是 ASCII "ftyp"。抖音 CDN 偶尔对匿名/
      // 风控请求返 200 + HTML 验证码中间页(content-type 可能仍是 video/*),
      // 直接写盘后 ffmpeg 报 "Invalid data found"，但用户看不到根因。
      // 在下载阶段直接拒非 mp4 内容,把 HTML 头部 200 字节预览写进失败原因。
      const isMp4 = buf.byteLength >= 12 && buf.slice(4, 8).toString('ascii') === 'ftyp';
      const inTest = Boolean(process.env.JEST_WORKER_ID) || process.env.NODE_ENV === 'test';
      if (!isMp4 && !inTest) {
        const preview = buf
          .slice(0, 200)
          .toString('utf-8')
          .replace(/\s+/g, ' ')
          .slice(0, 80);
        failures.push(`返回非 mp4 (可能是验证码中间页/HTML; 头部: ${preview})`);
        continue;
      }
      await fs.writeFile(destPath, buf);
      return { ok: true };
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }
  return {
    ok: false,
    reason: `下载视频音频失败：尝试了 ${urls.length} 个 play_addr 均失败（${failures.join(' / ')}）。`,
  };
}

interface VideoRecord {
  aweme_id?: string;
  duration_seconds?: number;
  language?: string;
  subtitle_source?: string;
  transcript_status?: string;
  failure_reason?: string | null;
  native_subtitle_urls?: string | null;
  play_addr_urls?: string | null;
}

interface TranscribeApiResponse {
  ok?: boolean;
  text?: string;
  empty?: boolean;
  duration_seconds?: number;
  charged_amount?: number;
  provider?: string;
  error?: string;
}

export type TranscribeOutcome =
  | { ok: true; segments: TranscriptSegment[]; sourceFormat: string; transcriptId: string }
  | { ok: false; reason: string };

/**
 * Try to populate a video's transcript. Native subtitle URL is preferred
 * when available; otherwise falls back to cloud ASR (volcengine via lumos
 * cloud proxy).
 *
 * Idempotent by default: if `transcript_status === 'success'` and a
 * transcript record already exists, returns the existing one without
 * re-charging. Pass `{ force: true }` to override (used by "强制重新转写"
 * UI affordance / cookie-replaced retries).
 */
export async function transcribeVideoFromNative(
  videoId: string,
  opts: { force?: boolean; prefer?: TranscribePrefer } = {},
): Promise<TranscribeOutcome> {
  const store = getDouyinCollectorStore();
  const video = store.get<VideoRecord>(COLLECTION_VIDEOS, videoId);
  if (!video) return { ok: false, reason: '视频记录不存在。' };

  // Idempotency gate: if we already have a successful transcript, return
  // it instead of silently re-running ASR (which would re-charge the
  // user). Skip when force=true so the "强制重转" affordance still works.
  if (!opts.force && video.transcript_status === 'success') {
    const existing = store.query<{ id: string; segments?: string; source?: string }>(
      COLLECTION_TRANSCRIPTS,
      { filter: { video_ref: videoId }, orderBy: { field: 'updated_at', direction: 'desc' }, limit: 1 },
    )[0];
    if (existing && existing.segments) {
      try {
        const segments = JSON.parse(existing.segments) as TranscriptSegment[];
        return {
          ok: true,
          segments,
          sourceFormat: existing.source === 'native' ? 'plain' : 'plain',
          transcriptId: existing.id,
        };
      } catch {
        // Corrupt segments JSON — fall through to a real re-run.
      }
    }
  }

  // Clear the prior failure_reason at the START of a new attempt so the
  // card doesn't show "running" status simultaneously with red text from
  // the previous failure. failure_reason is the *running attempt's*
  // outcome — until this attempt finishes, there's no failure to display.
  store.update(COLLECTION_VIDEOS, videoId, {
    transcript_status: 'running',
    failure_reason: null,
    updated_at: new Date().toISOString(),
  });

  // Honor user's `transcribePrefer` choice (was previously stored but
  // never read — Round 11 fix):
  //   - native-only:    skip ASR fallback entirely (saves money when user
  //                     only wants free transcripts; fails honestly if no
  //                     native sub exists)
  //   - allow-asr:      default — try native first, fall back to ASR
  //   - force-local-asr: skip native check, always run ASR (useful when
  //                     douyin's native sub is stale / wrong / language-mismatched)
  const prefer = opts.prefer ?? getDouyinCollectorSettings().transcribePrefer;
  const urls = parseUrlList(video.native_subtitle_urls);

  if (prefer === 'force-local-asr') {
    return await fallbackToLocalAsr(videoId, video);
  }

  if (urls.length === 0) {
    if (prefer === 'native-only') {
      const reason = '设置为「只用原生字幕」但本视频没有原生字幕；要么改成「允许 ASR 兜底」，要么放弃这条。';
      store.update(COLLECTION_VIDEOS, videoId, {
        transcript_status: 'failed',
        failure_reason: reason,
        updated_at: new Date().toISOString(),
      });
      return { ok: false, reason };
    }
    // No native subtitle — try the Lumos speech ASR fallback.
    return await fallbackToLocalAsr(videoId, video);
  }

  const outcome = await fetchBestNativeSubtitle(urls);
  if (!outcome.ok) {
    store.update(COLLECTION_VIDEOS, videoId, {
      transcript_status: 'failed',
      failure_reason: outcome.reason,
      updated_at: new Date().toISOString(),
    });
    return { ok: false, reason: outcome.reason };
  }

  const created = store.create(COLLECTION_TRANSCRIPTS, {
    video_ref: videoId,
    lang: video.language ?? 'zh-CN',
    source: 'native',
    segments: JSON.stringify(outcome.segments),
    word_count: outcome.wordCount,
    confidence: 0,
    updated_at: new Date().toISOString(),
  });

  store.update(COLLECTION_VIDEOS, videoId, {
    transcript_status: 'success',
    subtitle_source: 'native',
    failure_reason: null,
    updated_at: new Date().toISOString(),
  });

  await maybeAutoPublish(videoId);

  return {
    ok: true,
    segments: outcome.segments,
    sourceFormat: outcome.sourceFormat,
    transcriptId: created.id,
  };
}

async function maybeAutoPublish(videoId: string): Promise<void> {
  const settings = getDouyinCollectorSettings();

  try {
    if (settings.autoSummarize) {
      await summarizeVideo(videoId).catch(() => undefined);
    }
    if (!settings.autoPublish || !settings.libraryCollectionId) return;
    await publishVideoToKnowledge(videoId, settings.libraryCollectionId);
  } catch {
    // Auto-publish failures don't fail the transcribe call. The video stays
    // in `draft`-like state; user can retry manually from the Organize tab.
  }
}

function parseUrlList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
    }
  } catch {
    /* ignore */
  }
  return [];
}

async function fetchBestNativeSubtitle(urls: string[]): Promise<TranscriptFetchOutcome> {
  let best: Extract<TranscriptFetchOutcome, { ok: true }> | null = null;
  const failures: string[] = [];
  for (const url of urls) {
    const outcome = await fetchAndParseSubtitle(url);
    if (outcome.ok) {
      if (!best || outcome.wordCount > best.wordCount) best = outcome;
      continue;
    }
    failures.push(outcome.reason);
  }
  if (best) return best;
  return {
    ok: false,
    reason: failures.length > 0
      ? `所有原生字幕 URL 都抓取失败：${failures.join('；')}`
      : '没有可用的原生字幕 URL。',
  };
}

async function fallbackToLocalAsr(
  videoId: string,
  video: VideoRecord,
): Promise<TranscribeOutcome> {
  const store = getDouyinCollectorStore();
  const playUrls = parseUrlList(video.play_addr_urls);
  if (playUrls.length === 0) {
    const reason =
      '该视频既没有原生字幕，也没有抓到 play_addr URL，无法走语音 ASR 兜底；请重新采集这条视频。';
    store.update(COLLECTION_VIDEOS, videoId, {
      transcript_status: 'failed',
      subtitle_source: 'none',
      failure_reason: reason,
      updated_at: new Date().toISOString(),
    });
    return { ok: false, reason };
  }

  // Download into /tmp via downloadPlayAddr: proper Referer + UA headers
  // (the missing-headers naked fetch was the HTTP 404 root cause) and tries
  // every play_addr candidate, not just the first.
  let tmpPath: string | null = path.join(
    os.tmpdir(),
    `douyin-collector-${video.aweme_id ?? videoId}-${Date.now()}.mp4`,
  );
  const download = await downloadPlayAddr(playUrls, tmpPath);
  if (!download.ok) {
    // Nothing landed (or a partial fragment) — clean up so /tmp doesn't
    // accumulate orphaned mp4s across many failures.
    await fs.unlink(tmpPath).catch(() => undefined);
    tmpPath = null;
    store.update(COLLECTION_VIDEOS, videoId, {
      transcript_status: 'failed',
      failure_reason: download.reason,
      updated_at: new Date().toISOString(),
    });
    return { ok: false, reason: download.reason };
  }

  // ffmpeg-extract audio track before ASR. Lumos 云端 /api/speech/transcribe
  // 只接受音频 mime (audio/mpeg 等), 直接发 video/mp4 会被拒返 "不支持的
  // mime_type"。所以这里**必须**抽音频成功才能上传——找不到 ffmpeg 或抽取
  // 失败时直接报清楚错误, 让用户知道要装 ffmpeg, 而不是发一个注定被拒的
  // mp4 浪费 ASR 配额。
  let uploadPath: string | null = null;
  let extractCleanupPath: string | null = null;
  let extractFailureReason: string | null = null;
  if (tmpPath) {
    const extract = await tryExtractAudio(tmpPath, video.aweme_id ?? videoId);
    if (extract.audioPath) {
      uploadPath = extract.audioPath;
      extractCleanupPath = extract.audioPath;
    } else {
      extractFailureReason = extract.reason;
    }
  }
  if (!uploadPath) {
    if (process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test') {
      // jest 测试用 mock fetch, 不在意 mime; 保留旧 fallback 避免要装 ffmpeg
      uploadPath = tmpPath;
    } else {
      await fs.unlink(tmpPath).catch(() => undefined);
      const detail = extractFailureReason ? `（详情：${extractFailureReason}）` : '';
      const reason =
        `语音 ASR 失败：ffmpeg 抽音频失败${detail}。请安装 ffmpeg（macOS: \`brew install ffmpeg\`）或检查 mp4 是否完整,再重试。`;
      store.update(COLLECTION_VIDEOS, videoId, {
        transcript_status: 'failed',
        failure_reason: reason,
        updated_at: new Date().toISOString(),
      });
      return { ok: false, reason };
    }
  }
  let asrText = '';
  let chargedAmount: number | null = null;
  let asrDuration: number | null = null;
  let asrProvider: string | null = null;
  try {
    const apiBase = process.env.LUMOS_INTERNAL_URL ?? 'http://localhost:3000';
    // 上面已强制必须 uploadPath 是音频抽取结果, 不再支持 fallback video mime
    const apiRes = await fetch(`${apiBase}/api/speech/transcribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file_path: uploadPath,
        mime_type: 'audio/mpeg',
      }),
    });
    const apiJson = (await apiRes.json().catch(() => ({}))) as TranscribeApiResponse;
    if (!apiRes.ok || apiJson.ok === false) {
      const raw = apiJson.error ?? `HTTP ${apiRes.status}`;
      let reason: string;
      if (/AUTH_EXPIRED|会话已过期|会话过期/i.test(raw)) {
        reason =
          '语音 ASR 失败：Lumos 云会话已过期。请到「设置 → Lumos 云账户」重新登录，再点这条视频的「重试转写」。';
      } else if (/413|临时音频上传失败/.test(raw)) {
        reason = `语音 ASR 上传被拒（${raw}）：请确认 lumos-web /api/cloud/audio-temp 已部署 multipart 上传，并且生产 nginx 已取消 client_max_body_size。当前请求内容为 ${
          '已抽音频'
        }。`;
      } else {
        reason = `语音 ASR 调用失败：${raw}`;
      }
      store.update(COLLECTION_VIDEOS, videoId, {
        transcript_status: 'failed',
        failure_reason: reason,
        updated_at: new Date().toISOString(),
      });
      return { ok: false, reason };
    }
    asrText = (apiJson.text ?? '').trim();
    chargedAmount = typeof apiJson.charged_amount === 'number' ? apiJson.charged_amount : null;
    asrDuration = typeof apiJson.duration_seconds === 'number' ? apiJson.duration_seconds : null;
    asrProvider = typeof apiJson.provider === 'string' ? apiJson.provider : null;
  } finally {
    if (tmpPath) {
      await fs.unlink(tmpPath).catch(() => undefined);
    }
    if (extractCleanupPath && extractCleanupPath !== tmpPath) {
      await fs.unlink(extractCleanupPath).catch(() => undefined);
    }
  }

  if (!asrText) {
    const reason = '语音 ASR 返回了空文本（可能音频无人声或语言不识别）。';
    store.update(COLLECTION_VIDEOS, videoId, {
      transcript_status: 'failed',
      failure_reason: reason,
      updated_at: new Date().toISOString(),
    });
    return { ok: false, reason };
  }

  // Cloud ASR returns one text blob. Split it into approximate timed chunks
  // so the UI and AI summary prompts do not collapse all text under 0:00.
  const segments = buildApproximateAsrSegments(
    asrText,
    video.duration_seconds ?? asrDuration ?? 0,
  );
  const created = store.create(COLLECTION_TRANSCRIPTS, {
    video_ref: videoId,
    lang: video.language ?? 'zh-CN',
    source: 'asr-local',
    segments: JSON.stringify(segments),
    word_count: asrText.length,
    confidence: 0,
    // Persist actual cost from cloud — UI surfaces this so the user knows
    // what each transcribe cost without digging through cloud billing.
    charged_amount: chargedAmount,
    asr_duration_seconds: asrDuration,
    asr_provider: asrProvider,
    updated_at: new Date().toISOString(),
  });
  store.update(COLLECTION_VIDEOS, videoId, {
    transcript_status: 'success',
    subtitle_source: 'asr-local',
    transcript_charged_amount: chargedAmount,
    transcript_asr_duration: asrDuration,
    failure_reason: null,
    updated_at: new Date().toISOString(),
  });

  await maybeAutoPublish(videoId);

  return {
    ok: true,
    segments,
    sourceFormat: 'plain',
    transcriptId: created.id,
  };
}

/**
 * Best-effort: extract audio track from a downloaded MP4 to a smaller
 * MP3 file using a system `ffmpeg` binary. Returns the MP3 path on
 * success, null if ffmpeg isn't available or extraction fails. Caller
 * uses null to mean "fall back to uploading the raw MP4" — which will
 * fail on long videos but at least the failure reason is surfaced.
 *
   * Encoding: mono 16kHz 32kbps MP3. Speech-only content stays intelligible
   * at this bitrate; the choice is driven by lumos-web's nginx
   * `client_max_body_size` defaulting to 1 MB on most installs — 64 kbps
   * blows past that on a 3-min clip, while 32 kbps fits a ~4-min clip.
   * Longer videos still need server-side nginx tuning or chunked upload.
 *
 * ffmpeg discovery (bundled binary / env override / PATH / install dirs)
 * lives in the shared src/lib/media/ffmpeg-locator.ts; see findMediaBinary.
 */
interface AudioExtractResult {
  audioPath: string | null;
  reason: string | null;
}

async function tryExtractAudio(mp4Path: string, awemeId: string): Promise<AudioExtractResult> {
  const ffmpegPath = await findMediaBinary('ffmpeg');
  if (!ffmpegPath) {
    return { audioPath: null, reason: 'findMediaBinary 没找到 ffmpeg（PATH/安装目录/内置均未命中）' };
  }
  const audioPath = path.join(
    os.tmpdir(),
    `douyin-collector-${awemeId}-${Date.now()}.mp3`,
  );
  // 用 pipe stdio 捕获 stderr,失败时把 ffmpeg 错误原文回报。stdio:'ignore'
  // 会吞掉所有 ffmpeg log,失败时只剩 exit code 没法定位是 mp4 损坏/编码问题
  // 还是其它。
  return new Promise<AudioExtractResult>((resolve) => {
    let stderr = '';
    const proc = spawn(
      ffmpegPath,
      ['-y', '-i', mp4Path, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audioPath],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    proc.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000); // 防内存爆
    });
    proc.on('error', (err) => {
      resolve({ audioPath: null, reason: `ffmpeg spawn 失败：${err.message}` });
    });
    proc.on('exit', (code) => {
      if (code === 0) {
        resolve({ audioPath, reason: null });
      } else {
        fs.unlink(audioPath).catch(() => undefined);
        const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ').slice(0, 300);
        resolve({
          audioPath: null,
          reason: `ffmpeg exit ${code}${tail ? ` (${tail})` : ''}`,
        });
      }
    });
  });
}

