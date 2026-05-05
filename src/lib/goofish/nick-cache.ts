/**
 * Tiny file-backed cache for the user's current 闲鱼 display nickname.
 *
 * Why this exists: goofish's `mtop.taobao.idlemessage.pc.loginuser.get` API
 * (what `goofish auth status` calls) returns only `userId`, no nickname.
 * The `tracknick` cookie field is stale once the user changes nickname.
 *
 * The only place a fresh nickname surfaces in the goofish-cli surface is in
 * `message history` results — `send_user_name` for messages where the user
 * is the sender. So we extract it on login and cache it here, keyed by unb.
 *
 * Stored at `~/.lumos/goofish-nicks.json`, format: `{ "<unb>": "<nick>" }`.
 * Lost data is harmless — we just fall back to the stale tracknick again.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function cacheFile(): string {
  const dataDir = process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos');
  return path.join(dataDir, 'goofish-nicks.json');
}

function readAll(): Record<string, string> {
  const file = cacheFile();
  if (!existsSync(file)) return {};
  try {
    const raw = readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

export function getCachedNick(unb: string): string {
  if (!unb) return '';
  return readAll()[unb] || '';
}

export function setCachedNick(unb: string, nick: string): void {
  if (!unb || !nick) return;
  const all = readAll();
  if (all[unb] === nick) return;
  all[unb] = nick;
  const file = cacheFile();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(all, null, 2), { mode: 0o600 });
}
