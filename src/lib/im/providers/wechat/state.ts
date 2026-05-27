/**
 * WeChat Provider — On-Disk State (sync_buf cursor + per-peer context_token)
 *
 * 持久化文件：
 *   <LUMOS_DATA_DIR>/im-wechat/<account_id>/sync_buf.txt
 *   <LUMOS_DATA_DIR>/im-wechat/<account_id>/context-tokens.json
 *
 * 重启后 monitor 从 sync_buf 续上长轮询；send.ts 从 tokens 拿对端最近的 context_token。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function dataDir(): string {
  return process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos');
}

function sanitize(s: string): string {
  return s.replace(/[/\\:\0]/g, '_') || 'default';
}

function stateDir(accountId: string): string {
  return path.join(dataDir(), 'im-wechat', sanitize(accountId));
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

// ---- sync_buf (long-poll cursor) ------------------------------------------

const syncBufFile = (account: string) => path.join(stateDir(account), 'sync_buf.txt');

export function readSyncBuf(accountId: string): string {
  try {
    return fs.readFileSync(syncBufFile(accountId), 'utf-8');
  } catch {
    return '';
  }
}

export function writeSyncBuf(accountId: string, buf: string): void {
  try {
    ensureDir(stateDir(accountId));
    fs.writeFileSync(syncBufFile(accountId), buf, 'utf-8');
  } catch (err) {
    console.warn('[wechat/state] failed to persist sync_buf:', err);
  }
}

// ---- per-peer context_token store -----------------------------------------

const tokensFile = (account: string) => path.join(stateDir(account), 'context-tokens.json');

export class ContextTokenStore {
  private cache = new Map<string, string>();
  private loaded = false;
  private fileSignatures = new Map<string, string>();

  constructor(private readonly accountId: string) {}

  private tokenFiles(): string[] {
    const files = [tokensFile('default')];
    if (this.accountId !== 'default') files.push(tokensFile(this.accountId));
    return files;
  }

  private signature(file: string): string {
    try {
      const stat = fs.statSync(file);
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return '';
    }
  }

  private load(force = false): void {
    if (this.loaded && !force) return;
    const nextCache = new Map<string, string>();
    const nextSignatures = new Map<string, string>();

    for (const file of this.tokenFiles()) {
      const sig = this.signature(file);
      nextSignatures.set(file, sig);
      if (!sig) continue;
      try {
        const raw = fs.readFileSync(file, 'utf-8');
        const parsed = JSON.parse(raw) as Record<string, string>;
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string') nextCache.set(k, v);
        }
      } catch {
        // Another process may be writing the small JSON file right now. Keep the
        // previous in-memory view and retry on the next get() instead of
        // replacing it with an empty cache.
        if (!this.loaded) this.loaded = true;
        return;
      }
    }

    this.cache = nextCache;
    this.fileSignatures = nextSignatures;
    this.loaded = true;
  }

  private refreshIfChanged(): void {
    if (!this.loaded) {
      this.load();
      return;
    }
    for (const file of this.tokenFiles()) {
      if (this.fileSignatures.get(file) !== this.signature(file)) {
        this.load(true);
        return;
      }
    }
  }

  get(peer: string): string {
    this.refreshIfChanged();
    return this.cache.get(peer) || '';
  }

  set(peer: string, token: string): void {
    this.refreshIfChanged();
    if (!token.trim()) return;
    if (this.cache.get(peer) === token) return;
    this.cache.set(peer, token);
    try {
      ensureDir(stateDir(this.accountId));
      const file = tokensFile(this.accountId);
      fs.writeFileSync(
        file,
        JSON.stringify(Object.fromEntries(this.cache), null, 2),
        'utf-8',
      );
      this.fileSignatures.set(file, this.signature(file));
    } catch (err) {
      console.warn('[wechat/state] failed to persist context token:', err);
    }
  }
}
