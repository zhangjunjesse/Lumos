import crypto from 'node:crypto';

import type Database from 'better-sqlite3';

import { getDb } from '@/lib/db';

const DEFAULT_TARGET_KEY = 'app.im.default_user_target';
const LATEST_CONTEXT_PREFIX = 'app.im.latest_notification';
const CONTEXT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AppImTarget {
  providerId: string;
  chatId: string;
  label?: string;
  source: 'wechat-inbound' | 'manual' | 'app-notification';
  updatedAt: number;
}

export interface AppImNotificationContext {
  providerId: string;
  chatId: string;
  appId: string;
  appName: string;
  notificationId?: string;
  title?: string;
  text: string;
  reason?: string;
  messageId?: string;
  sentAt: number;
}

export function recordDefaultUserImTarget(
  target: Omit<AppImTarget, 'updatedAt'> & { updatedAt?: number },
  db: Database.Database = getDb(),
): void {
  if (!target.providerId.trim() || !target.chatId.trim()) return;
  writeSetting(db, DEFAULT_TARGET_KEY, JSON.stringify({
    providerId: target.providerId.trim(),
    chatId: target.chatId.trim(),
    label: target.label?.trim() || undefined,
    source: target.source,
    updatedAt: target.updatedAt ?? Date.now(),
  }));
}

export function getDefaultUserImTarget(
  db: Database.Database = getDb(),
): AppImTarget | null {
  const raw = readSetting(db, DEFAULT_TARGET_KEY);
  const parsed = safeJson<AppImTarget>(raw);
  if (!parsed || typeof parsed.providerId !== 'string' || typeof parsed.chatId !== 'string') {
    return null;
  }
  if (!parsed.providerId.trim() || !parsed.chatId.trim()) return null;
  return {
    providerId: parsed.providerId.trim(),
    chatId: parsed.chatId.trim(),
    label: typeof parsed.label === 'string' ? parsed.label : undefined,
    source: parsed.source === 'manual' || parsed.source === 'app-notification'
      ? parsed.source
      : 'wechat-inbound',
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
  };
}

export function recordLatestAppImNotification(
  context: AppImNotificationContext,
  db: Database.Database = getDb(),
): void {
  if (!context.providerId.trim() || !context.chatId.trim() || !context.appId.trim()) return;
  writeSetting(
    db,
    latestContextKey(context.providerId, context.chatId),
    JSON.stringify({
      ...context,
      providerId: context.providerId.trim(),
      chatId: context.chatId.trim(),
      appId: context.appId.trim(),
      appName: context.appName.trim() || context.appId.trim(),
      text: context.text.trim(),
      sentAt: context.sentAt || Date.now(),
    }),
  );
}

export function getLatestAppImNotification(
  providerId: string,
  chatId: string,
  db: Database.Database = getDb(),
  opts: { now?: number; ttlMs?: number } = {},
): AppImNotificationContext | null {
  const parsed = safeJson<AppImNotificationContext>(
    readSetting(db, latestContextKey(providerId, chatId)),
  );
  if (!parsed || typeof parsed.sentAt !== 'number') return null;
  const now = opts.now ?? Date.now();
  const ttl = opts.ttlMs ?? CONTEXT_TTL_MS;
  if (now - parsed.sentAt > ttl) return null;
  if (!parsed.appId || !parsed.appName || !parsed.text) return null;
  return parsed;
}

export function buildLatestAppImNotificationHint(
  providerId: string,
  chatId: string,
  db: Database.Database = getDb(),
): string | null {
  const context = getLatestAppImNotification(providerId, chatId, db);
  if (!context) return null;
  const parts = [
    `**Latest Lumos app notification in this IM chat**`,
    `The most recent app notification sent to this chat was from app "${context.appName}" (${context.appId}).`,
    context.title ? `Title: ${context.title}` : '',
    context.reason ? `Reason: ${context.reason}` : '',
    `Notification text: ${trimForPrompt(context.text, 600)}`,
    `Sent at: ${new Date(context.sentAt).toISOString()}`,
    '',
    'If the user appears to be replying to that notification, handle the reply as the Lumos Main Agent with this app context. The user is not directly chatting with the app.',
  ].filter(Boolean);
  return parts.join('\n');
}

function latestContextKey(providerId: string, chatId: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${providerId}\n${chatId}`)
    .digest('hex')
    .slice(0, 32);
  return `${LATEST_CONTEXT_PREFIX}.${providerId}.${hash}`;
}

function readSetting(db: Database.Database, key: string): string | null {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

function writeSetting(db: Database.Database, key: string, value: string): void {
  try {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(key, value);
  } catch (err) {
    console.warn('[app/im-bridge] failed to write setting:', err);
  }
}

function safeJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function trimForPrompt(text: string, max: number): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}...`;
}
