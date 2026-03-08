import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import {
  getAllSessions,
  getMessages,
  getSetting,
  listRecentMemories,
  listRecentMemoryIntelligenceEvents,
  listMemoryIntelligenceEventsSince,
} from '@/lib/db';
import type { MemoryRecord } from '@/lib/db/memories';
import { getMindPersonaHistory, getMindPersonaProfile } from '@/lib/mind/profile';
import { getMindRulesHistory, getMindRulesProfile } from '@/lib/mind/rules-profile';
import { buildMindRuntimePack, type MindRuntimePackSection } from '@/lib/mind/runtime-pack';
import { getDefaultMemoryIntelligencePrompts, getMemoryIntelligenceConfig } from '@/lib/memory/intelligence';
import { parseMessageContent } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface MindMemoryItem {
  id: string;
  scope: string;
  category: string;
  content: string;
  tags: string[];
  source: string;
  projectPath: string;
  projectName: string;
  hitCount: number;
  isPinned: boolean;
  isArchived: boolean;
  lastUsedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

interface MindTimelineEvent {
  id: string;
  type: 'memory' | 'session';
  title: string;
  detail: string;
  time: string;
  category: string;
  scope: string;
  source: string;
  projectPath: string;
  projectName: string;
  state: 'active' | 'archived';
}

type MindWeeklyStoryCode = 'quiet' | 'steady' | 'growing' | 'surging';

interface MindWeeklyDigest {
  periodStart: string;
  periodEnd: string;
  newMemories: number;
  updatedMemories: number;
  activeDays: number;
  reusedTimes: number;
  topTags: Array<{ tag: string; count: number }>;
  categoryPulse: Array<{ key: string; count: number }>;
  storyCode: MindWeeklyStoryCode;
  topCategory: string;
}

interface MindMemoryIntelligenceEvent {
  id: string;
  trigger: string;
  outcome: string;
  reason: string;
  candidateCount: number;
  savedCount: number;
  tokenEstimate: number;
  createdAt: string;
  sessionId: string;
  details: Record<string, unknown>;
}

interface MindMemoryIntelligenceStats {
  recentTriggerCount: number;
  recentSavedRuns: number;
  recentSavedMemories: number;
  recentSkippedRuns: number;
  recentErrors: number;
  recentTokenEstimate: number;
  byTrigger: Array<{ key: string; count: number }>;
  byOutcome: Array<{ key: string; count: number }>;
}

interface MindRuntimePackPreview {
  sourceOrder: string[];
  sections: MindRuntimePackSection[];
  memoryItems: number;
  samplePrompt: string;
  preview: string;
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .slice(0, 20);
  } catch {
    return [];
  }
}

function readTextPreview(filePath: string, maxChars = 1600): string {
  if (!filePath || !fs.existsSync(filePath)) return '';
  try {
    const text = fs.readFileSync(filePath, 'utf-8').trim();
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}\n...`;
  } catch {
    return '';
  }
}

function listFileNames(dirPath: string, limit = 30): string[] {
  if (!dirPath || !fs.existsSync(dirPath)) return [];
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, limit);
  } catch {
    return [];
  }
}

function getActiveSession() {
  const sessions = getAllSessions();
  const hit = sessions.find((session) => {
    const cwd = (session.sdk_cwd || session.working_directory || '').trim();
    return Boolean(cwd);
  });
  return hit || sessions[0] || null;
}

function extractMessageText(rawContent: string): string {
  const blocks = parseMessageContent(rawContent);
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text' && block.text.trim()) {
      parts.push(block.text.trim());
    }
  }
  return parts.join('\n').trim();
}

function getLatestUserPrompt(sessionId: string): string {
  const normalized = sessionId.trim();
  if (!normalized) return '';
  const { messages } = getMessages(normalized, { limit: 24 });
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== 'user') continue;
    const text = extractMessageText(message.content);
    if (text) return text.slice(0, 2000);
  }
  return '';
}

function buildRuntimePackPreview(sessionId: string, projectPath: string): MindRuntimePackPreview {
  const samplePrompt = getLatestUserPrompt(sessionId) || '根据最近上下文继续协作，并保持风格一致。';
  const runtimePack = buildMindRuntimePack({
    sessionId,
    projectPath,
    prompt: samplePrompt,
    maxMemoryItems: 6,
    trackMemoryUsage: false,
  });
  return {
    sourceOrder: runtimePack.sourceOrder,
    sections: runtimePack.sections,
    memoryItems: runtimePack.memoryItems,
    samplePrompt,
    preview: runtimePack.additionalContext,
  };
}

function getMemoryContextLimit(): number {
  const raw = getSetting('memory_context_max_items');
  const parsed = Number(raw || '');
  if (!Number.isFinite(parsed)) return 8;
  return Math.max(1, Math.min(Math.floor(parsed), 20));
}

function toMindMemoryItem(record: MemoryRecord): MindMemoryItem {
  const projectPath = (record.project_path || '').trim();
  return {
    id: record.id,
    scope: record.scope,
    category: record.category,
    content: record.content,
    tags: parseTags(record.tags),
    source: record.source,
    projectPath,
    projectName: projectPath ? path.basename(projectPath) : '',
    hitCount: record.hit_count || 0,
    isPinned: record.is_pinned === 1,
    isArchived: record.is_archived === 1,
    lastUsedAt: record.last_used_at || null,
    updatedAt: record.updated_at,
    createdAt: record.created_at,
  };
}

function takeContentsByCategory(memories: MindMemoryItem[], category: string, limit = 8): string[] {
  return memories
    .filter((memory) => memory.category === category)
    .slice(0, limit)
    .map((memory) => memory.content);
}

function collectDominantTags(memories: MindMemoryItem[], limit = 12): Array<{ tag: string; count: number }> {
  const counter = new Map<string, number>();
  for (const memory of memories) {
    for (const tag of memory.tags) {
      counter.set(tag, (counter.get(tag) || 0) + 1);
    }
  }
  return Array.from(counter.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}

function countBy<K extends string>(items: K[]): Array<{ key: K; count: number }> {
  const counter = new Map<K, number>();
  for (const item of items) {
    counter.set(item, (counter.get(item) || 0) + 1);
  }
  return Array.from(counter.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

function getWeeklyStoryCode(params: {
  newMemories: number;
  updatedMemories: number;
  activeDays: number;
  reusedTimes: number;
}): MindWeeklyStoryCode {
  const {
    newMemories,
    updatedMemories,
    activeDays,
    reusedTimes,
  } = params;
  if (updatedMemories <= 1 && newMemories === 0) return 'quiet';

  const isSurging = newMemories >= 8 || activeDays >= 6 || reusedTimes >= 36 || updatedMemories >= 16;
  if (isSurging) return 'surging';

  const isGrowing = newMemories >= 4 || updatedMemories >= 8 || activeDays >= 4 || reusedTimes >= 18;
  if (isGrowing) return 'growing';

  return 'steady';
}

function buildTimeline(memories: MindMemoryItem[]): MindTimelineEvent[] {
  const memoryEvents: MindTimelineEvent[] = memories.slice(0, 120).map((memory) => ({
    id: `memory-${memory.id}`,
    type: 'memory',
    title: `[${memory.category}] ${memory.content}`,
    detail: `${memory.scope}${memory.projectName ? ` · ${memory.projectName}` : ''}${memory.source ? ` · ${memory.source}` : ''}`,
    time: memory.updatedAt,
    category: memory.category,
    scope: memory.scope,
    source: memory.source,
    projectPath: memory.projectPath,
    projectName: memory.projectName,
    state: memory.isArchived ? 'archived' : 'active',
  }));

  const sessionEvents: MindTimelineEvent[] = getAllSessions()
    .slice(0, 60)
    .map((session) => {
      const projectPath = (session.sdk_cwd || session.working_directory || '').trim();
      return {
      id: `session-${session.id}`,
      type: 'session',
      title: session.title || 'Untitled session',
      detail: projectPath || 'No working directory',
      time: session.updated_at || session.created_at,
      category: 'session',
      scope: 'session',
      source: 'chat',
      projectPath,
      projectName: projectPath ? path.basename(projectPath) : '',
      state: 'active',
    };
    });

  return [...memoryEvents, ...sessionEvents]
    .sort((a, b) => {
      const ats = Date.parse(a.time.replace(' ', 'T'));
      const bts = Date.parse(b.time.replace(' ', 'T'));
      return (Number.isFinite(bts) ? bts : 0) - (Number.isFinite(ats) ? ats : 0);
    })
    .slice(0, 160);
}

function parseTime(value: string): number {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const hasZone = normalized.includes('Z') || /[+-]\d{2}:\d{2}$/.test(normalized);
  const ts = Date.parse(hasZone ? normalized : `${normalized}Z`);
  return Number.isFinite(ts) ? ts : 0;
}

function parseEventDetails(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function formatSinceSql(days: number): string {
  const now = Date.now();
  const delta = Math.max(1, days) * 24 * 60 * 60 * 1000;
  return new Date(now - delta).toISOString().replace('T', ' ').split('.')[0];
}

function buildMemoryIntelligenceStats(days = 7): {
  stats: MindMemoryIntelligenceStats;
  recentEvents: MindMemoryIntelligenceEvent[];
} {
  const sinceSql = formatSinceSql(days);
  const recentEventsRaw = listMemoryIntelligenceEventsSince(sinceSql);
  const recentEvents: MindMemoryIntelligenceEvent[] = listRecentMemoryIntelligenceEvents(60).map((event) => ({
    id: event.id,
    trigger: event.trigger,
    outcome: event.outcome,
    reason: event.reason,
    candidateCount: event.candidate_count,
    savedCount: event.saved_count,
    tokenEstimate: event.token_estimate,
    createdAt: event.created_at,
    sessionId: event.session_id,
    details: parseEventDetails(event.details),
  }));

  const byTrigger = countBy(recentEventsRaw.map((event) => event.trigger));
  const byOutcome = countBy(recentEventsRaw.map((event) => event.outcome));
  const recentSavedRuns = recentEventsRaw.filter((event) => event.saved_count > 0).length;
  const recentSavedMemories = recentEventsRaw.reduce((sum, event) => sum + event.saved_count, 0);
  const recentSkippedRuns = recentEventsRaw.filter((event) => event.outcome === 'skipped').length;
  const recentErrors = recentEventsRaw.filter((event) => event.outcome === 'error').length;
  const recentTokenEstimate = recentEventsRaw.reduce((sum, event) => sum + event.token_estimate, 0);

  return {
    stats: {
      recentTriggerCount: recentEventsRaw.length,
      recentSavedRuns,
      recentSavedMemories,
      recentSkippedRuns,
      recentErrors,
      recentTokenEstimate,
      byTrigger,
      byOutcome,
    },
    recentEvents,
  };
}

function startOfDayIso(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function buildWeeklyDigest(memories: MindMemoryItem[]): MindWeeklyDigest {
  const now = Date.now();
  const startTs = now - 6 * 24 * 60 * 60 * 1000;
  const periodStart = new Date(startTs).toISOString().slice(0, 10);
  const periodEnd = new Date(now).toISOString().slice(0, 10);

  const updatedMemories = memories.filter((memory) => parseTime(memory.updatedAt) >= startTs);
  const newMemories = memories.filter((memory) => parseTime(memory.createdAt) >= startTs);

  const daySet = new Set<string>();
  for (const memory of updatedMemories) {
    const ts = parseTime(memory.updatedAt);
    if (ts > 0) daySet.add(startOfDayIso(ts));
  }

  const topTags = collectDominantTags(updatedMemories, 8);
  const categoryPulse = countBy(updatedMemories.map((memory) => memory.category)).slice(0, 6);
  const reusedTimes = updatedMemories.reduce((sum, item) => sum + item.hitCount, 0);
  const topCategory = categoryPulse[0]?.key || '';
  const storyCode = getWeeklyStoryCode({
    newMemories: newMemories.length,
    updatedMemories: updatedMemories.length,
    activeDays: daySet.size,
    reusedTimes,
  });

  return {
    periodStart,
    periodEnd,
    newMemories: newMemories.length,
    updatedMemories: updatedMemories.length,
    activeDays: daySet.size,
    reusedTimes,
    topTags,
    categoryPulse,
    storyCode,
    topCategory,
  };
}

export async function GET(request: NextRequest) {
  try {
    const includeArchived = request.nextUrl.searchParams.get('includeArchived') === 'true';
    const allMemories = listRecentMemories(360, { includeArchived: true })
      .map(toMindMemoryItem)
      .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt.localeCompare(a.updatedAt));
    const activeMemories = allMemories.filter((memory) => !memory.isArchived);
    const visibleMemories = includeArchived ? allMemories : activeMemories;
    const memorySystemEnabled = getSetting('memory_system_enabled') !== 'false';
    const projectRulesEnabled = getSetting('claude_project_settings_enabled') === 'true';
    const memoryContextMaxItems = getMemoryContextLimit();
    const personaProfile = getMindPersonaProfile();
    const personaHistory = getMindPersonaHistory(20);
    const rulesProfile = getMindRulesProfile();
    const rulesHistory = getMindRulesHistory(20);

    const activeSession = getActiveSession();
    const activeProjectPath = (activeSession?.sdk_cwd || activeSession?.working_directory || '').trim();
    const claudeMdPath = activeProjectPath ? path.join(activeProjectPath, 'CLAUDE.md') : '';
    const rulesDirPath = activeProjectPath ? path.join(activeProjectPath, '.claude', 'rules') : '';
    const hooksDirPath = activeProjectPath ? path.join(activeProjectPath, '.claude', 'hooks') : '';

    const rulesFiles = listFileNames(rulesDirPath);
    const hooksFiles = listFileNames(hooksDirPath);
    const runtimePackPreview = activeSession
      ? buildRuntimePackPreview(activeSession.id, activeProjectPath)
      : {
          sourceOrder: ['platform_safety', 'user_current_turn', 'lumos_persona', 'lumos_rules', 'persisted_memory'],
          sections: [],
          memoryItems: 0,
          samplePrompt: '',
          preview: '',
        };

    const totalHitCount = activeMemories.reduce((acc, memory) => acc + memory.hitCount, 0);
    const activeProjectsCount = new Set(
      activeMemories
        .map((memory) => memory.projectPath)
        .filter(Boolean)
    ).size;
    const projectMemoryCount = activeMemories.filter((memory) => memory.scope === 'project').length;
    const archivedMemories = allMemories.length - activeMemories.length;

    const memoryIntelligenceConfig = getMemoryIntelligenceConfig();
    const memoryIntelligenceDefaults = getDefaultMemoryIntelligencePrompts();
    const memoryIntelligence = buildMemoryIntelligenceStats(7);

    const response = {
      snapshotAt: new Date().toISOString(),
      stats: {
        totalMemories: activeMemories.length,
        visibleMemories: visibleMemories.length,
        archivedMemories,
        projectMemoryCount,
        activeProjectsCount,
        totalHitCount,
      },
      persona: {
        preferenceSignals: takeContentsByCategory(activeMemories, 'preference', 10),
        boundarySignals: takeContentsByCategory(activeMemories, 'constraint', 10),
        workflowSignals: takeContentsByCategory(activeMemories, 'workflow', 10),
        dominantTags: collectDominantTags(activeMemories, 12),
      },
      personaProfile,
      personaHistory,
      rulesProfile,
      rulesHistory,
      rules: {
        memorySystemEnabled,
        projectRulesEnabled,
        memoryContextMaxItems,
        activeProjectPath,
        activeProjectName: activeProjectPath ? path.basename(activeProjectPath) : '',
        claudeMdPath,
        claudeMdExists: Boolean(claudeMdPath && fs.existsSync(claudeMdPath)),
        claudeMdPreview: readTextPreview(claudeMdPath),
        rulesDirPath,
        rulesFiles,
        hooksDirPath,
        hooksFiles,
      },
      runtimePack: runtimePackPreview,
      memoryIntelligence: {
        activeSession: activeSession ? {
          id: activeSession.id,
          title: activeSession.title,
          projectPath: activeProjectPath,
        } : null,
        settings: memoryIntelligenceConfig,
        defaults: memoryIntelligenceDefaults,
        stats: memoryIntelligence.stats,
        recentEvents: memoryIntelligence.recentEvents,
      },
      experience: {
        byCategory: countBy(activeMemories.map((memory) => memory.category)),
        byScope: countBy(activeMemories.map((memory) => memory.scope)),
        bySource: countBy(activeMemories.map((memory) => memory.source)),
        topReusedMemories: activeMemories
          .filter((memory) => memory.hitCount > 0)
          .sort((a, b) => b.hitCount - a.hitCount || b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 12),
      },
      timeline: buildTimeline(visibleMemories),
      weeklyDigest: buildWeeklyDigest(activeMemories),
      memories: visibleMemories,
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load mind snapshot';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
