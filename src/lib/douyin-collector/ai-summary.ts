import { z } from 'zod';

import { getDefaultProvider } from '@/lib/db/providers';
import { resolveProviderModelForRequest } from '@/lib/model-metadata';
import { providerSupportsCapability } from '@/lib/provider-config';
import { generateObjectFromProvider } from '@/lib/text-generator';

import { COLLECTION_TRANSCRIPTS, COLLECTION_VIDEOS } from './constants';
import { formatTimedTranscript, parseTranscriptText, parseVideoTags } from './parsers';
import { getDouyinCollectorSettings } from './settings';
import { getDouyinCollectorStore } from './storage';

export const summarySchema = z.object({
  summary: z
    .string()
    .min(1)
    .describe('面向知识采集的客观摘要：先列结论，再给关键论据。4–6 句话。'),
  chapters: z
    .array(
      z.object({
        startSec: z.number().nonnegative().describe('章节起始秒数'),
        title: z.string().min(1).describe('章节标题（名词短语，不超过 12 字）'),
      }),
    )
    .describe(
      '按字幕语义切分的章节列表，每段 1–3 分钟。如果视频太短或主题单一，可以只返回一个章节。',
    ),
  tags: z
    .array(z.string().min(1))
    .min(1)
    .describe('3–8 个具体标签，描述主题 / 领域 / 人物 / 技术名词，避免泛词。'),
});

export type SummaryShape = z.infer<typeof summarySchema>;

export type SummarizeOutcome =
  | { ok: true; summary: SummaryShape }
  | { ok: false; reason: string };

interface VideoForSummary {
  aweme_id?: string;
  title?: string | null;
  creator_nickname?: string | null;
  duration_seconds?: number;
  tags?: string | null;
}

interface TranscriptForSummary {
  segments?: string;
  word_count?: number;
}

/**
 * Generate AI summary / chapter cuts / tag suggestions for a collected
 * douyin video. Reads the saved prompts from settings, calls the configured
 * default provider with structured output, and writes the result back to
 * the video record.
 *
 * Honest contract: returns structured failure when no provider is
 * configured, no transcript exists, or the LLM call fails. Never invents
 * content.
 */
export async function summarizeVideo(videoId: string): Promise<SummarizeOutcome> {
  const store = getDouyinCollectorStore();
  const video = store.get<VideoForSummary>(COLLECTION_VIDEOS, videoId);
  if (!video) return { ok: false, reason: '视频记录不存在。' };

  const transcripts = store.query<TranscriptForSummary>(COLLECTION_TRANSCRIPTS, {
    filter: { video_ref: videoId },
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: 1,
  });
  const transcript = transcripts[0];
  // Round 174: use the timestamped format ([m:ss] line) so the LLM can
  // ground chapter startSec in real timecodes from the transcript.
  // Pre-Round-174 we sent plain text → LLM hallucinated startSec by
  // estimating from word density (often wildly off for long videos).
  const transcriptText = formatTimedTranscript(transcript?.segments);
  // Fall back to plain text only when timed format is unavailable —
  // shouldn't happen in practice (segments always have startSec) but
  // protects against malformed legacy rows.
  const transcriptForPrompt = transcriptText || parseTranscriptText(transcript?.segments);
  if (!transcriptForPrompt.trim()) {
    return {
      ok: false,
      reason: '该视频还没有 transcript；请先「抓字幕」再生成摘要。',
    };
  }

  const provider = getDefaultProvider();
  if (!provider) {
    return { ok: false, reason: '尚未配置默认 LLM provider；请到「设置 → Provider」选一个。' };
  }
  if (!providerSupportsCapability(provider, 'text-gen')) {
    return {
      ok: false,
      reason: `provider「${provider.name}」不支持文本生成。`,
    };
  }
  const model = resolveProviderModelForRequest(provider, null, 'sonnet');
  if (!model) {
    return {
      ok: false,
      reason: `provider「${provider.name}」没有可用的文本模型。`,
    };
  }

  const settings = getDouyinCollectorSettings();
  const { system, prompt } = buildSummaryRequest({
    title: video.title ?? null,
    creatorNickname: video.creator_nickname ?? null,
    durationSeconds: video.duration_seconds ?? 0,
    transcriptText: transcriptForPrompt,
    summaryStyle: settings.aiSummaryPrompt,
    chaptersStyle: settings.aiChaptersPrompt,
    tagsStyle: settings.aiTagsPrompt,
  });

  let result: SummaryShape;
  try {
    result = await generateObjectFromProvider({
      providerId: provider.id,
      model,
      system,
      prompt,
      schema: summarySchema,
      maxTokens: 2048,
      temperature: 0.2,
    });
  } catch (err) {
    return {
      ok: false,
      reason: `LLM 调用失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Merge AI-generated tags with existing tags (case-insensitive dedup)
  // instead of overwriting. Preserves:
  //   - keyword path's seeded tag (Round 116/127)
  //   - user-edited tags from OrganizeTab
  // AI suggestions get appended as new tags they didn't already have.
  const existingTags = parseVideoTags(video.tags);
  const lowered = new Set(existingTags.map((t) => t.toLowerCase()));
  const mergedTags = [...existingTags];
  for (const t of result.tags) {
    if (!lowered.has(t.toLowerCase())) {
      lowered.add(t.toLowerCase());
      mergedTags.push(t);
    }
  }
  store.update(COLLECTION_VIDEOS, videoId, {
    summary: result.summary,
    tags: JSON.stringify(mergedTags),
    chapters: JSON.stringify(result.chapters),
    updated_at: new Date().toISOString(),
  });

  return { ok: true, summary: result };
}

export interface SummaryRequestInput {
  title: string | null;
  creatorNickname: string | null;
  durationSeconds: number;
  transcriptText: string;
  summaryStyle: string;
  chaptersStyle: string;
  tagsStyle: string;
}

/**
 * Build the LLM `(system, prompt)` pair for the AI summary call. Pure
 * function so prompt-shape regressions can be caught by unit tests.
 *
 * Honest contract: empty fields render as placeholders; user-configured
 * style guidance from settings is appended verbatim — the user can
 * customize tone / length without touching code.
 */
export function buildSummaryRequest(input: SummaryRequestInput): {
  system: string;
  prompt: string;
} {
  const system = [
    `你是抖音采集器的内容整理助手。`,
    `视频元信息：标题「${input.title?.trim() || '未知标题'}」，作者「${input.creatorNickname?.trim() || '未知博主'}」，时长 ${input.durationSeconds ?? 0} 秒。`,
    `输出格式严格遵循 JSON Schema，三个字段都必须给出。`,
    `**章节 startSec 必须使用字幕里 [m:ss] 标记的真实时间**（转换成秒：[2:15] = 135）；不要凭语速估算。如果字幕没有时间戳标记，按段落顺序保守输出。`,
    `摘要风格：${input.summaryStyle}`,
    `章节切分风格：${input.chaptersStyle}`,
    `标签风格：${input.tagsStyle}`,
  ].join('\n\n');

  const prompt = `下面是该视频的字幕（每行格式 [m:ss] 文本），请基于它生成 summary / chapters / tags：\n\n${input.transcriptText}`;

  return { system, prompt };
}

