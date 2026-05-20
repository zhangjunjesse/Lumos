import { getDb, getSetting, setSetting } from '@/lib/db';
import { normalizeBrowserContextId } from '@/lib/browser-provider/labels';

/**
 * Douyin collector settings live in the global Lumos settings store rather
 * than the per-app data store, because they're operational config the user
 * sets once. The native-app spec's `app_settings` collection mirrors the
 * boundaries (risk_note, ai_system_prompt) for declarative pages, but the
 * runtime reads from here.
 */

const KEY_COOKIE = 'douyin_collector_cookie';
const KEY_COOKIE_CHECKED_AT = 'douyin_collector_cookie_checked_at';
const KEY_COOKIE_LAST_OK_AT = 'douyin_collector_cookie_last_ok_at';
const KEY_TRANSCRIBE_PREFER = 'douyin_collector_transcribe_prefer';
const KEY_LONG_VIDEO_SPLIT_MINUTES = 'douyin_collector_long_video_split_minutes';
const KEY_TRANSCRIBE_CONCURRENCY = 'douyin_collector_transcribe_concurrency';
const KEY_LIBRARY_COLLECTION_ID = 'douyin_collector_library_collection_id';
const KEY_AUTO_PUBLISH = 'douyin_collector_auto_publish';
const KEY_AUTO_SUMMARIZE = 'douyin_collector_auto_summarize';
const KEY_AUTO_TRANSCRIBE = 'douyin_collector_auto_transcribe';
const KEY_AI_SUMMARY_PROMPT = 'douyin_collector_ai_summary_prompt';
const KEY_AI_CHAPTERS_PROMPT = 'douyin_collector_ai_chapters_prompt';
const KEY_AI_TAGS_PROMPT = 'douyin_collector_ai_tags_prompt';
const KEY_RISK_NOTE = 'douyin_collector_risk_note';
const KEY_BROWSER_CONTEXT_ID = 'douyin_collector_browser_context_id';

const DEFAULT_LIBRARY_COLLECTION_NAME = '联网搜索资料';
const DEFAULT_LIBRARY_COLLECTION_DESCRIPTION =
  '由 DeepSearch 自动归档的网页内容，来自知乎、微信公众号、小红书、掘金等';

export const TRANSCRIBE_PREFER_OPTIONS = ['native-only', 'allow-asr', 'force-local-asr'] as const;
export type TranscribePrefer = (typeof TRANSCRIBE_PREFER_OPTIONS)[number];

export interface DouyinCollectorSettings {
  cookie: string;
  cookieCheckedAt: string | null;
  cookieLastOkAt: string | null;
  transcribePrefer: TranscribePrefer;
  longVideoSplitMinutes: number;
  transcribeConcurrency: number;
  libraryCollectionId: string | null;
  autoPublish: boolean;
  autoSummarize: boolean;
  autoTranscribe: boolean;
  aiSummaryPrompt: string;
  aiChaptersPrompt: string;
  aiTagsPrompt: string;
  riskNote: string;
  /**
   * Which Lumos browser context creator/keyword scraping must use.
   * Explicit user choice — no silent fallback to another browser
   * (a wrong/un-launched context fails loudly pointing at itself,
   * instead of the old auto-guess that masked the real cause).
   */
  browserContextId: string;
}

const DEFAULT_AI_SUMMARY = `请用 4–6 句话总结这条抖音视频的要点：先列结论，再给关键论据；用客观陈述，不加营销修辞。`;
const DEFAULT_AI_CHAPTERS = `根据字幕分段提议章节切分（每段 1–3 分钟），每个章节给一个名词短语标题，避免重复。`;
const DEFAULT_AI_TAGS = `用 3–8 个标签描述这条视频的主题、领域、人物、技术名词；不要泛泛的「视频」「内容」之类。`;
const DEFAULT_RISK_NOTE = [
  '只采集公开视频元数据 / 字幕 / 封面，不下载视频原文件用于分发。',
  '字幕优先级：抖音原生字幕 → 抖音 ASR → Lumos speech-to-text MCP 兜底。',
  'Cookie 失效或风控触发时立即停止后续 job，状态进入 needs_auth；不绕过任何风控措施。',
  '禁止：发评论 / 点赞 / 私信 / 关注；批量下载用于分发；商业用途的内容再分发。',
].join('\n');

export function getDouyinCollectorSettings(): DouyinCollectorSettings {
  const savedLibraryCollectionId = (getSetting(KEY_LIBRARY_COLLECTION_ID) ?? '') || null;
  return {
    cookie: getSetting(KEY_COOKIE) ?? '',
    cookieCheckedAt: (getSetting(KEY_COOKIE_CHECKED_AT) ?? '') || null,
    cookieLastOkAt: (getSetting(KEY_COOKIE_LAST_OK_AT) ?? '') || null,
    transcribePrefer: normalizePrefer(getSetting(KEY_TRANSCRIBE_PREFER)),
    longVideoSplitMinutes: parseInt(getSetting(KEY_LONG_VIDEO_SPLIT_MINUTES) ?? '10', 10) || 10,
    transcribeConcurrency: parseInt(getSetting(KEY_TRANSCRIBE_CONCURRENCY) ?? '3', 10) || 3,
    libraryCollectionId: savedLibraryCollectionId ?? ensureDefaultLibraryCollectionId(),
    autoPublish: (getSetting(KEY_AUTO_PUBLISH) ?? 'false') === 'true',
    autoSummarize: (getSetting(KEY_AUTO_SUMMARIZE) ?? 'false') === 'true',
    autoTranscribe: (getSetting(KEY_AUTO_TRANSCRIBE) ?? 'false') === 'true',
    aiSummaryPrompt: getSetting(KEY_AI_SUMMARY_PROMPT) ?? DEFAULT_AI_SUMMARY,
    aiChaptersPrompt: getSetting(KEY_AI_CHAPTERS_PROMPT) ?? DEFAULT_AI_CHAPTERS,
    aiTagsPrompt: getSetting(KEY_AI_TAGS_PROMPT) ?? DEFAULT_AI_TAGS,
    riskNote: getSetting(KEY_RISK_NOTE) ?? DEFAULT_RISK_NOTE,
    browserContextId: normalizeBrowserContextId(getSetting(KEY_BROWSER_CONTEXT_ID)),
  };
}

function ensureDefaultLibraryCollectionId(): string | null {
  try {
    const db = getDb();
    const existing = db
      .prepare('SELECT id FROM kb_collections WHERE name = ? ORDER BY created_at DESC LIMIT 1')
      .get(DEFAULT_LIBRARY_COLLECTION_NAME) as { id: string } | undefined;
    if (existing?.id) {
      return existing.id;
    }
    const now = Date.now();
    const id = `douyin_default_${now.toString(36)}`;
    db.prepare(
      'INSERT INTO kb_collections (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, DEFAULT_LIBRARY_COLLECTION_NAME, DEFAULT_LIBRARY_COLLECTION_DESCRIPTION, now, now);
    return id;
  } catch {
    return null;
  }
}

export function updateDouyinCollectorSettings(patch: Partial<DouyinCollectorSettings>): DouyinCollectorSettings {
  if (typeof patch.cookie === 'string') {
    // Cookie identity governs cookieLastOkAt: when the user replaces an
    // old cookie with a new one, the old "last OK probe" timestamp no
    // longer applies. If we don't invalidate, Hero can show "Cookie 3
    // 小时前 OK" right after the user pasted a typo'd cookie — lying
    // about the new value's health until the 36h stale check kicks in.
    // Re-saving the SAME value (e.g., user clicked save without editing)
    // preserves lastOkAt — that's not a state change worth invalidating.
    const trimmed = patch.cookie.trim();
    const prev = (getSetting(KEY_COOKIE) ?? '').trim();
    setSetting(KEY_COOKIE, trimmed);
    setSetting(KEY_COOKIE_CHECKED_AT, new Date().toISOString());
    if (trimmed !== prev) {
      setSetting(KEY_COOKIE_LAST_OK_AT, '');
    }
  }
  if (patch.transcribePrefer && TRANSCRIBE_PREFER_OPTIONS.includes(patch.transcribePrefer)) {
    setSetting(KEY_TRANSCRIBE_PREFER, patch.transcribePrefer);
  }
  if (typeof patch.longVideoSplitMinutes === 'number' && patch.longVideoSplitMinutes > 0) {
    setSetting(KEY_LONG_VIDEO_SPLIT_MINUTES, String(Math.floor(patch.longVideoSplitMinutes)));
  }
  if (typeof patch.transcribeConcurrency === 'number' && patch.transcribeConcurrency > 0) {
    setSetting(KEY_TRANSCRIBE_CONCURRENCY, String(Math.floor(patch.transcribeConcurrency)));
  }
  if (patch.libraryCollectionId !== undefined) {
    const newValue = patch.libraryCollectionId === null ? '' : String(patch.libraryCollectionId);
    setSetting(KEY_LIBRARY_COLLECTION_ID, newValue);
    // Round 172: autoPublish has no meaning without a target collection
    // (maybeAutoPublish silently returns when libraryCollectionId is
    // empty, leading to "I turned auto-publish on but nothing publishes"
    // confusion). Clearing the collection auto-flips autoPublish off so
    // the persisted state can't lie about what the pipeline will do.
    if (!newValue) {
      setSetting(KEY_AUTO_PUBLISH, 'false');
    }
  }
  if (typeof patch.autoPublish === 'boolean') {
    setSetting(KEY_AUTO_PUBLISH, patch.autoPublish ? 'true' : 'false');
  }
  if (typeof patch.autoSummarize === 'boolean') {
    setSetting(KEY_AUTO_SUMMARIZE, patch.autoSummarize ? 'true' : 'false');
  }
  if (typeof patch.autoTranscribe === 'boolean') {
    setSetting(KEY_AUTO_TRANSCRIBE, patch.autoTranscribe ? 'true' : 'false');
  }
  if (typeof patch.aiSummaryPrompt === 'string') setSetting(KEY_AI_SUMMARY_PROMPT, patch.aiSummaryPrompt);
  if (typeof patch.aiChaptersPrompt === 'string') setSetting(KEY_AI_CHAPTERS_PROMPT, patch.aiChaptersPrompt);
  if (typeof patch.aiTagsPrompt === 'string') setSetting(KEY_AI_TAGS_PROMPT, patch.aiTagsPrompt);
  if (typeof patch.riskNote === 'string') setSetting(KEY_RISK_NOTE, patch.riskNote);
  if (typeof patch.browserContextId === 'string') {
    setSetting(KEY_BROWSER_CONTEXT_ID, normalizeBrowserContextId(patch.browserContextId));
  }

  return getDouyinCollectorSettings();
}

function normalizePrefer(value: string | null | undefined): TranscribePrefer {
  if (value && (TRANSCRIBE_PREFER_OPTIONS as readonly string[]).includes(value)) {
    return value as TranscribePrefer;
  }
  return 'allow-asr';
}

/**
 * Mark the moment when a cookie probe succeeded. Used by the Settings UI
 * to grey the cookie chip after ~36h of no successful probes (suggesting
 * the user re-test or refresh) — separate from `cookieCheckedAt` which
 * only reflects last-saved time.
 */
export function markCookieOk(now: Date = new Date()): void {
  setSetting(KEY_COOKIE_LAST_OK_AT, now.toISOString());
}
