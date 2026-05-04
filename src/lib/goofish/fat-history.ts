/**
 * Sidecar runners for the Python helpers under
 * `resources/mcp-servers/goofish/`. We wrap two scripts:
 *
 *   - `history_fat.py`  — message history with full fields (createAt etc.)
 *   - `chats_fat.py`    — chat list with peer disambiguation, avatars, items
 *
 * Both reuse goofish-cli's auth + WS code, replacing only the parsing step
 * to keep fields the upstream CLI throws away.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { GoofishCliException } from './cli';
import { findGoofishPython, getRealUserSite, buildGoofishEnv } from './env';

// Re-export so other modules don't need to reach into env.ts directly.
export { findGoofishPython, getRealUserSite, buildGoofishEnv };

export interface FatMessage {
  message_id: string;
  created_at: number;
  send_user_id: string;
  send_user_name: string;
  /** When I sent the message, this is the peer's uid. Useful for one-way chats. */
  receiver_user_id: string;
  /** 0 = unknown, 1 = read, 2 = unread (per upstream userMessageModel). */
  read_status: number;
  summary: string;
  outer_content_type: number;
  message: Record<string, unknown>;
}

export async function fetchFatHistory(cid: string, limit: number, cookiesPath?: string): Promise<FatMessage[]> {
  const data = await runSidecar<{ messages?: FatMessage[] }>(
    'history_fat.py', ['--cid', cid, '--limit', String(limit)], 30_000, cookiesPath,
  );
  return Array.isArray(data?.messages) ? data.messages : [];
}

export interface FatChatSession {
  session_id: string;
  session_type: number;
  peer_user_id: string;
  peer_nick: string;
  peer_avatar: string;
  unread: number;
  last_msg: string;
  ts: number;
  item_id: string;
  item_title: string;
  item_main_pic: string;
  source: 'baseline' | 'watch';
}

export interface FatChatsResult {
  sessions: FatChatSession[];
  read_receipts: Record<string, string[]>;
}

export async function fetchFatChats(fetchNum: number, watchSecs: number, cookiesPath?: string): Promise<FatChatsResult> {
  const data = await runSidecar<FatChatsResult>(
    'chats_fat.py', ['--fetch-num', String(fetchNum), '--watch-secs', String(watchSecs)],
    30_000 + Math.ceil(watchSecs * 1000), cookiesPath,
  );
  return {
    sessions: Array.isArray(data?.sessions) ? data.sessions : [],
    read_receipts: data?.read_receipts || {},
  };
}

async function runSidecar<T>(scriptName: string, args: string[], timeoutMs: number, cookiesPath?: string): Promise<T> {
  const py = findGoofishPython();
  const script = path.join(getRuntimePath(), 'mcp-servers', 'goofish', scriptName);
  if (!existsSync(script)) {
    throw new GoofishCliException({
      code: 'NOT_INSTALLED',
      message: `${scriptName} missing at ${script}`,
    });
  }
  return await new Promise<T>((resolve, reject) => {
    const child = spawn(py, [script, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildGoofishEnv({ cookiesPath }),
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new GoofishCliException({ code: 'EXEC_FAILED', message: `${scriptName} timed out` }));
    }, timeoutMs);
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new GoofishCliException({ code: 'EXEC_FAILED', message: `${scriptName} exited ${code}`, stderr }));
        return;
      }
      try { resolve(JSON.parse(stdout)); }
      catch (e) {
        reject(new GoofishCliException({ code: 'PARSE_FAILED', message: `${scriptName} bad JSON: ${(e as Error).message}`, stderr }));
      }
    });
  });
}

function getRuntimePath(): string {
  // Mirror src/lib/wechat-export/key-extractor.ts:getRuntimePath
  if (process.resourcesPath && existsSync(path.join(process.resourcesPath, 'mcp-servers'))) {
    return process.resourcesPath;
  }
  return path.join(process.cwd(), 'resources');
}

