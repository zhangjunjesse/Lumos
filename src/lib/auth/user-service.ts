/**
 * Core user business logic: registration, login, profile, balance.
 *
 * Orchestrates password, session, email verification, and new-api modules.
 */

import crypto from 'crypto';
import { getDb } from '@/lib/db/connection';
import { hashPassword } from './password';
import { createSession, validateSession } from './session';
import {
  provisionCloudProvider,
  provisionImageProviders,
  provisionChatProviders,
  persistCustomProviderFlags,
  type CloudImageProviderConfig,
  type CloudChatProviderConfig,
} from '@/lib/lumos-cloud-auth';
import type { CustomProviderFlags } from './custom-provider-capabilities';
import type { LumosUser } from './types';

export type { LumosUser } from './types';

interface RegisterParams {
  email: string;
  code: string;
  password: string;
  nickname?: string;
}

interface AuthResult {
  user: LumosUser;
  token: string;
}

function nowISO(): string {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

function stripPasswordHash(row: LumosUser & { password_hash?: string }): LumosUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password_hash: _, ...user } = row;
  return user;
}

/**
 * Register a new user via lumos-web.
 * Desktop has no SMTP / no new-api admin credentials — registration, email
 * verification, and token provisioning all happen server-side. Desktop only
 * mirrors the resulting user into local DB and opens a local session.
 */
export async function registerUser(params: RegisterParams): Promise<AuthResult> {
  const { user: remoteUser, response } = await fetchRemoteRegister(params);
  const webSessionToken = extractWebSessionToken(response);
  upsertLocalUser(remoteUser, webSessionToken, nowISO());
  await provisionUserServices(remoteUser);

  const session = createSession(remoteUser.id);
  const user = getUserById(remoteUser.id)!;
  return { user, token: session.token };
}

async function fetchRemoteRegister(params: RegisterParams): Promise<{ user: RemoteUser; response: Response }> {
  const webBase = process.env.LUMOS_WEB_URL || 'http://lumos.miki.zj.cn';
  const response = await fetch(`${webBase}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await response.json();
  if (!data.success || !data.data) {
    throw new Error(data.error || data.message || '注册失败');
  }
  return { user: (data.data.user ?? data.data) as RemoteUser, response };
}

/**
 * Extract lumos_session cookie from a fetch Response's Set-Cookie header.
 * Used to capture the session token so Lumos desktop can call lumos-web APIs
 * (quota, orders, etc.) on behalf of the user.
 */
function extractWebSessionToken(res: Response): string {
  const setCookieList = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookieList) {
    const match = c.match(/lumos_session=([^;]+)/);
    if (match) return match[1];
  }
  const raw = res.headers.get('set-cookie') || '';
  const match = raw.match(/lumos_session=([^;]+)/);
  return match ? match[1] : '';
}

interface RemoteUser {
  id: string;
  email: string;
  nickname: string;
  role: 'admin' | 'user';
  membership: 'free' | 'monthly' | 'yearly';
  status: string;
  newapi_token_key: string | null;
  newapi_token_id: number | null;
  image_providers?: CloudImageProviderConfig[];
  /**
   * 新版 lumos-web 会下发 chat_providers；旧版本不含此字段。
   * 字段存在（含空数组）→ 以此为权威，全量同步；字段缺失 → 回退到
   * 旧的单一 Lumos Cloud provisioner，保证老服务器兼容。
   */
  chat_providers?: CloudChatProviderConfig[];
  allow_custom_providers?: Partial<CustomProviderFlags>;
}

async function fetchRemoteLogin(account: string, password: string): Promise<{ user: RemoteUser; response: Response }> {
  const webBase = process.env.LUMOS_WEB_URL || 'http://lumos.miki.zj.cn';
  const response = await fetch(`${webBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password }),
  });
  const data = await response.json();
  if (!data.success || !data.data) {
    throw new Error(data.error || '账号或密码错误');
  }
  return { user: data.data as RemoteUser, response };
}

function upsertLocalUser(remoteUser: RemoteUser, webSessionToken: string, now: string): void {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM lumos_users WHERE id = ?').get(remoteUser.id);
  if (existing) {
    db.prepare(
      `UPDATE lumos_users SET
        email = ?, nickname = ?, role = ?, membership = ?,
        newapi_token_key = ?, newapi_token_id = ?,
        web_session_token = ?, last_login_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      remoteUser.email, remoteUser.nickname, remoteUser.role, remoteUser.membership,
      remoteUser.newapi_token_key, remoteUser.newapi_token_id,
      webSessionToken, now, now, remoteUser.id,
    );
    return;
  }
  db.prepare(
    `INSERT INTO lumos_users
     (id, email, password_hash, nickname, role, membership, newapi_token_key, newapi_token_id, web_session_token, created_at, updated_at, last_login_at)
     VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    remoteUser.id, remoteUser.email, remoteUser.nickname, remoteUser.role, remoteUser.membership,
    remoteUser.newapi_token_key, remoteUser.newapi_token_id,
    webSessionToken, now, now, now,
  );
}

async function provisionUserServices(remoteUser: RemoteUser): Promise<void> {
  if (remoteUser.chat_providers !== undefined) {
    try {
      await provisionChatProviders(remoteUser.chat_providers);
    } catch (e) {
      console.warn('[login] Failed to provision chat providers:', e);
    }
  } else if (remoteUser.newapi_token_key) {
    // 老服务器未下发 chat_providers，维持旧的单 Lumos Cloud provisioner 兜底。
    await provisionCloudProvider(`sk-${remoteUser.newapi_token_key}`);
  }
  try {
    await provisionImageProviders(remoteUser.image_providers ?? []);
  } catch (e) {
    console.warn('[login] Failed to provision image providers:', e);
  }
  await persistCustomProviderFlags(remoteUser.allow_custom_providers ?? {});
}

/**
 * Login with email or nickname and password.
 * Authenticates against lumos-web website (not local DB).
 * On success, upserts the user into local DB and provisions the Lumos Cloud provider.
 */
export async function loginUser(
  emailOrNickname: string,
  password: string,
): Promise<AuthResult> {
  const { user: remoteUser, response } = await fetchRemoteLogin(emailOrNickname, password);
  const webSessionToken = extractWebSessionToken(response);
  upsertLocalUser(remoteUser, webSessionToken, nowISO());
  await provisionUserServices(remoteUser);

  const session = createSession(remoteUser.id);
  const user = getUserById(remoteUser.id)!;
  return { user, token: session.token };
}

/**
 * Get a user by their ID.
 */
export function getUserById(id: string): LumosUser | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM lumos_users WHERE id = ?',
  ).get(id) as (LumosUser & { password_hash?: string }) | undefined;

  return row ? stripPasswordHash(row) : null;
}

/**
 * Get a user by their session token.
 */
export function getUserBySession(token: string): LumosUser | null {
  return validateSession(token);
}

/**
 * Seed the initial admin user if lumos_users table is empty.
 * Called during app startup. Uses ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NICKNAME env vars.
 * If ADMIN_PASSWORD is unset, a random password is generated and printed once —
 * we refuse to ship a hardcoded default so a forgotten env var cannot leave
 * a well-known password in production.
 */
export function seedAdminUser(): void {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) AS c FROM lumos_users').get() as { c: number };
  if (count.c > 0) return;

  const email = process.env.ADMIN_EMAIL || 'admin@lumos.local';
  const nickname = process.env.ADMIN_NICKNAME || 'admin';
  const envPassword = process.env.ADMIN_PASSWORD;
  const password = envPassword || crypto.randomBytes(18).toString('base64url');

  const userId = crypto.randomUUID();
  const now = nowISO();
  const passwordHash = hashPassword(password);

  db.prepare(
    `INSERT INTO lumos_users
     (id, email, password_hash, nickname, role, membership, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'admin', 'monthly', ?, ?)`,
  ).run(userId, email, passwordHash, nickname, now, now);

  if (envPassword) {
    console.log(`[auth] Seeded admin user: ${nickname} (${email})`);
  } else {
    console.warn(
      `[auth] Seeded admin user with RANDOM password (ADMIN_PASSWORD not set).\n`
      + `       nickname=${nickname} email=${email}\n`
      + `       initial password: ${password}\n`
      + `       Copy it now — it will NOT be shown again. Set ADMIN_PASSWORD to override.`,
    );
  }
}

/**
 * Desktop is a single-user local app. Workflow execution has no HTTP request
 * context to read a session cookie from, so we resolve the currently active
 * user by picking the most recent unexpired session.
 *
 * Used by stage-worker so workflow agents attribute image generation quota
 * to the logged-in user (otherwise image-gen-tool skips consumeRemoteQuota
 * and lumos_image_usage on the website never increments).
 */
export function getActiveUserId(): string | undefined {
  try {
    const db = getDb();
    const row = db.prepare(
      `SELECT user_id FROM lumos_user_sessions
       WHERE expires_at > datetime('now')
       ORDER BY created_at DESC
       LIMIT 1`,
    ).get() as { user_id: string } | undefined;
    return row?.user_id;
  } catch {
    return undefined;
  }
}

const WEB_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const BALANCE_TIMEOUT_MS = 5_000;

/**
 * Refresh user balance by proxying through lumos-web (the only node with
 * server-side new-api admin credentials). Desktop must never hold those
 * credentials — they'd be packaged into the client binary.
 */
export async function refreshUserBalance(
  userId: string,
): Promise<{ remainQuota: number; usedQuota: number }> {
  const db = getDb();
  const row = db.prepare(
    'SELECT web_session_token FROM lumos_users WHERE id = ?',
  ).get(userId) as { web_session_token: string } | undefined;

  const webToken = row?.web_session_token || '';
  if (!webToken) {
    throw new Error('未登录 Lumos 云账户，无法查询余额');
  }
  if (!WEB_TOKEN_PATTERN.test(webToken)) {
    throw new Error('Web 会话 token 格式异常');
  }

  const webBase = process.env.LUMOS_WEB_URL || 'http://lumos.miki.zj.cn';
  const res = await fetch(`${webBase}/api/auth/me`, {
    headers: { Cookie: `lumos_session=${webToken}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`lumos-web 返回 ${res.status}`);
  }
  const data = await res.json();
  if (!data.success || !data.data) {
    throw new Error(data.message || '查询余额失败');
  }

  return {
    remainQuota: Number(data.data.balance ?? 0),
    usedQuota: Number(data.data.used_quota ?? 0),
  };
}
