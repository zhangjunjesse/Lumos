/**
 * Knowledge health checker — activity scoring, staleness detection, archive suggestions
 * Rule-driven, no API cost. Formula: activity = reference_count * e^(-days/90)
 */
import { getDb } from '@/lib/db';
import type { HealthScore } from './types';

const DECAY_HALF_LIFE = 90; // days
const STALE_KEYWORDS = ['草案', 'draft', 'WIP', '待定', 'TODO', '临时'];
const ARCHIVE_ACTIVITY_THRESHOLD = 0.1;
const ARCHIVE_AGE_MONTHS = 6;
const OUTDATED_GRACE_DAYS = 30;

interface ItemRow {
  id: string;
  title: string;
  content: string;
  tags: string;
  reference_count: number;
  health_status: string;
  created_at: string;
  updated_at: string;
  doc_date: string | null;
}

function daysSince(dateStr: string): number {
  const d = new Date(dateStr).getTime();
  if (isNaN(d)) return 999;
  return (Date.now() - d) / (1000 * 60 * 60 * 24);
}

function calcActivity(refCount: number, daysSinceUpdate: number): number {
  return Math.max(refCount, 1) * Math.exp(-daysSinceUpdate / DECAY_HALF_LIFE);
}

function detectStale(title: string, content: string): string[] {
  const reasons: string[] = [];
  const text = `${title} ${content.slice(0, 500)}`.toLowerCase();

  for (const kw of STALE_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) {
      reasons.push(`包含关键词"${kw}"`);
    }
  }

  // Check for old year references
  const currentYear = new Date().getFullYear();
  const yearMatch = text.match(/20[12]\d/g);
  if (yearMatch) {
    const years = yearMatch.map(Number);
    const oldest = Math.min(...years);
    if (currentYear - oldest >= 3) {
      reasons.push(`引用了${oldest}年的内容`);
    }
  }

  return reasons;
}

/** Check health for a single item */
export function checkItemHealth(itemId: string): HealthScore | null {
  const db = getDb();
  const item = db.prepare(
    'SELECT id, title, content, tags, reference_count, health_status, created_at, updated_at, doc_date FROM kb_items WHERE id=?'
  ).get(itemId) as ItemRow | undefined;

  if (!item) return null;

  const days = daysSince(item.updated_at);
  const activity = calcActivity(item.reference_count, days);
  const staleReasons = detectStale(item.title, item.content);
  const isStale = staleReasons.length > 0;

  const ageMonths = daysSince(item.created_at) / 30;
  const isOutdated = item.health_status === 'outdated';
  const shouldArchive =
    (isOutdated && daysSince(item.updated_at) > OUTDATED_GRACE_DAYS) ||
    (activity < ARCHIVE_ACTIVITY_THRESHOLD && ageMonths > ARCHIVE_AGE_MONTHS);

  const reasons = [...staleReasons];
  if (activity < ARCHIVE_ACTIVITY_THRESHOLD) {
    reasons.push(`活跃度低(${activity.toFixed(2)})`);
  }
  if (shouldArchive) {
    reasons.push('建议归档');
  }

  return {
    itemId,
    activity: Math.round(activity * 1000) / 1000,
    isStale,
    isOutdated,
    shouldArchive,
    reasons,
  };
}

/** Check health for all items and persist results */
export function checkAllHealth(): HealthScore[] {
  const db = getDb();
  const items = db.prepare('SELECT id FROM kb_items').all() as { id: string }[];
  const results: HealthScore[] = [];

  for (const { id } of items) {
    const score = checkItemHealth(id);
    if (!score) continue;
    results.push(score);
    persistHealth(id, score);
  }

  return results;
}

function persistHealth(itemId: string, score: HealthScore) {
  const db = getDb();
  let status = 'healthy';
  if (score.shouldArchive) status = 'archived';
  else if (score.isOutdated) status = 'outdated';
  else if (score.isStale) status = 'stale';

  const now = new Date().toISOString();
  db.prepare(
    'UPDATE kb_items SET health_status=?, health_reason=?, health_checked_at=? WHERE id=?'
  ).run(status, score.reasons.join('; '), now, itemId);
}

/** Increment reference count when a search result is used */
export function incrementReference(itemId: string) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE kb_items SET reference_count = reference_count + 1, last_referenced_at=? WHERE id=?'
  ).run(now, itemId);
}
