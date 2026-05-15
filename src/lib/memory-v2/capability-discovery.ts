import crypto from 'crypto';
import { getSetting, setSetting } from '@/lib/db';
import { listMemoryV2Entries } from './store';
import type { CapabilityResearchSource } from './capability-lab';
import {
  recordMemoryV2ThirdPartyCapabilityResearchEvent,
  type MemoryV2CapabilityEventType,
} from './capability-events';
import type { MemoryV2Entry } from './types';

export interface MemoryV2CapabilityDiscoveryCandidate {
  fingerprint: string;
  capabilityType: MemoryV2CapabilityEventType;
  capabilityName: string;
  source: CapabilityResearchSource;
  title: string;
  summary: string;
  evidence: string;
  tags: string[];
  sourceMemoryId: string;
}

export interface MemoryV2CapabilityDiscoveryResult {
  scanned: number;
  created: MemoryV2CapabilityDiscoveryCandidate[];
  skipped: number;
  sourceCounts: Record<string, number>;
}

const SEEN_KEY = 'memory_v2_capability_discovery_seen_fingerprints';
const MAX_SEEN = 300;
const MAX_CREATED_PER_RUN = 6;

function normalizeText(value: unknown, max = 2000): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed)
      ? parsed.map((item) => normalizeText(item, 48)).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function parseSeenFingerprints(): string[] {
  try {
    const parsed = JSON.parse(getSetting(SEEN_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item)).filter(Boolean).slice(-MAX_SEEN)
      : [];
  } catch {
    return [];
  }
}

function saveSeenFingerprints(values: string[]): void {
  setSetting(SEEN_KEY, JSON.stringify(Array.from(new Set(values)).slice(-MAX_SEEN)));
}

function fingerprintFor(memory: MemoryV2Entry, source: CapabilityResearchSource, capabilityType: MemoryV2CapabilityEventType): string {
  return crypto
    .createHash('sha1')
    .update(`${memory.id}:${memory.updated_at}:${source}:${capabilityType}`)
    .digest('hex')
    .slice(0, 24);
}

function slug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
  return normalized || 'capability-research';
}

function shouldInspect(memory: MemoryV2Entry): boolean {
  if (memory.status !== 'active' && memory.status !== 'candidate') return false;
  const tags = parseTags(memory.tags).join(' ');
  const text = `${memory.title}\n${memory.body}\n${memory.summary}\n${tags}`.toLowerCase();
  if (!/(能力|缺口|失败|不能|无法|需要|补齐|自动|自我改进|mcp|skill|tool|工具|研究|采集|发现|github|deepsearch|douyin|抖音)/i.test(text)) {
    return false;
  }
  return /(缺少|缺口|失败|无法|不能|需要|补齐|自动发现|自我改进|可复用|沉淀|二开|rewrite|gap|failed|missing|should)/i.test(text);
}

function inferSource(memory: MemoryV2Entry): CapabilityResearchSource {
  const text = `${memory.title}\n${memory.body}\n${memory.summary}\n${memory.evidence}`.toLowerCase();
  if (/douyin|抖音|巨量|短视频|评论|达人|话题|采集/.test(text)) return 'douyin';
  if (/github|git repo|repository|开源|第三方|skill\.md|mcp server|npm|pip/.test(text)) return 'github';
  if (/deepsearch|深度研究|深度搜索|调研|网页搜索|反爬|登录态|研究任务/.test(text)) return 'deepsearch';
  return 'deepsearch';
}

function inferCapabilityType(memory: MemoryV2Entry): MemoryV2CapabilityEventType {
  const text = `${memory.title}\n${memory.body}\n${memory.summary}\n${memory.evidence}`.toLowerCase();
  if (/skill|提示词|prompt|写作|风格|sop|checklist|模板/.test(text) && !/(api|数据库|采集|文件|运行|脚本|mcp|工具|tool)/.test(text)) {
    return 'skill';
  }
  return 'mcp';
}

function buildCandidate(memory: MemoryV2Entry): MemoryV2CapabilityDiscoveryCandidate | null {
  if (!shouldInspect(memory)) return null;
  const source = inferSource(memory);
  const capabilityType = inferCapabilityType(memory);
  const fingerprint = fingerprintFor(memory, source, capabilityType);
  const prefix = source === 'douyin' ? 'douyin' : source === 'github' ? 'github' : 'deepsearch';
  const capabilityName = `${prefix}-${slug(memory.title).slice(0, 42)}-${fingerprint.slice(0, 6)}`;
  const noun = capabilityType === 'mcp' ? 'MCP' : 'Skill';
  const title = `睡眠自主发现：${source} 方向可研究 ${noun}「${memory.title}」`;
  const summary = [
    `每日睡眠从行动记忆中发现一个可进入能力研究队列的缺口，方向为 ${source}，建议先研究参考模式，再生成 Lumos 自己的 ${noun}。`,
    `原始记忆：${memory.title}`,
  ].join('\n');
  const evidence = [
    `source_memory_id=${memory.id}`,
    memory.body,
    memory.evidence,
  ].filter(Boolean).join('\n');
  return {
    fingerprint,
    capabilityType,
    capabilityName,
    source,
    title,
    summary,
    evidence,
    tags: ['sleep-autodiscovery', source, capabilityType, 'capability-research'],
    sourceMemoryId: memory.id,
  };
}

export function runMemoryV2CapabilityDiscovery(params: {
  limit?: number;
} = {}): MemoryV2CapabilityDiscoveryResult {
  const limit = Math.max(20, Math.min(params.limit ?? 160, 500));
  const memories = listMemoryV2Entries({ status: 'all', includeArchived: false, limit });
  const seen = parseSeenFingerprints();
  const seenSet = new Set(seen);
  const created: MemoryV2CapabilityDiscoveryCandidate[] = [];
  let skipped = 0;
  const sourceCounts: Record<string, number> = {};

  for (const memory of memories) {
    const candidate = buildCandidate(memory);
    if (!candidate) continue;
    sourceCounts[candidate.source] = (sourceCounts[candidate.source] || 0) + 1;
    if (seenSet.has(candidate.fingerprint)) {
      skipped += 1;
      continue;
    }
    recordMemoryV2ThirdPartyCapabilityResearchEvent({
      capabilityType: candidate.capabilityType,
      capabilityName: candidate.capabilityName,
      action: 'third_party_discovered',
      source: `capability-research:${candidate.source}`,
      summary: candidate.summary,
      detail: candidate.evidence,
      metadata: {
        researchSource: candidate.source,
        title: candidate.title,
        tags: candidate.tags,
        autoDownload: false,
        discoveryMode: 'sleep-local',
        sourceMemoryId: candidate.sourceMemoryId,
        fingerprint: candidate.fingerprint,
        externalTaskState: 'not_started',
      },
    });
    created.push(candidate);
    seenSet.add(candidate.fingerprint);
    if (created.length >= MAX_CREATED_PER_RUN) break;
  }

  if (created.length > 0) {
    saveSeenFingerprints([...seen, ...created.map((candidate) => candidate.fingerprint)]);
  }

  return {
    scanned: memories.length,
    created,
    skipped,
    sourceCounts,
  };
}
