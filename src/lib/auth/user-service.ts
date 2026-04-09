/**
 * Core user business logic: registration, login, profile, balance.
 *
 * Orchestrates password, session, email verification, and new-api modules.
 */

import crypto from 'crypto';
import { getDb } from '@/lib/db/connection';
import { hashPassword, verifyPassword } from './password';
import { createSession, validateSession } from './session';
import { verifyCode } from './email';
import { createNewApiToken, getTokenQuota } from './newapi-admin';
import { provisionCloudProvider } from '@/lib/lumos-cloud-auth';
import type { LumosUser } from './types';

export type { LumosUser } from './types';

const DEFAULT_FREE_QUOTA = 5_000_000; // ~= 10 RMB

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

function getFreeQuota(): number {
  const env = process.env.REGISTER_FREE_QUOTA;
  return env ? Number(env) : DEFAULT_FREE_QUOTA;
}

function stripPasswordHash(row: LumosUser & { password_hash?: string }): LumosUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password_hash: _, ...user } = row;
  return user;
}

/**
 * Register a new user.
 * 1. Verify email code
 * 2. Check duplicate email
 * 3. Hash password
 * 4. Create new-api token with free quota
 * 5. Insert user record
 * 6. Provision local cloud provider
 * 7. Create session
 */
export async function registerUser(params: RegisterParams): Promise<AuthResult> {
  const { email, code, password, nickname } = params;

  if (!verifyCode(email, code, 'register')) {
    throw new Error('验证码无效或已过期');
  }

  const db = getDb();
  const existing = db.prepare(
    'SELECT id FROM lumos_users WHERE email = ?',
  ).get(email);
  if (existing) {
    throw new Error('该邮箱已注册');
  }

  const passwordHash = hashPassword(password);
  const quota = getFreeQuota();
  const { tokenId, tokenKey } = await createNewApiToken(`lumos-${email}`, quota);

  const userId = crypto.randomUUID();
  const now = nowISO();

  db.prepare(
    `INSERT INTO lumos_users
     (id, email, password_hash, nickname, newapi_token_key, newapi_token_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, email, passwordHash, nickname || '', tokenKey, tokenId, now, now);

  // Provision a Lumos Cloud provider with the new-api key
  await provisionCloudProvider(tokenKey);

  const session = createSession(userId);
  const user = getUserById(userId)!;

  return { user, token: session.token };
}

/**
 * Login with email or nickname and password.
 */
export async function loginUser(
  emailOrNickname: string,
  password: string,
): Promise<AuthResult> {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM lumos_users WHERE (email = ? OR nickname = ?) AND status = ?',
  ).get(emailOrNickname, emailOrNickname, 'active') as (LumosUser & { password_hash: string }) | undefined;

  if (!row) {
    throw new Error('账号或密码错误');
  }

  if (!verifyPassword(password, row.password_hash)) {
    throw new Error('账号或密码错误');
  }

  // Update last_login_at
  const now = nowISO();
  db.prepare(
    'UPDATE lumos_users SET last_login_at = ?, updated_at = ? WHERE id = ?',
  ).run(now, now, row.id);

  const session = createSession(row.id);

  return { user: stripPasswordHash(row), token: session.token };
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
 * Falls back to nickname 'admin' with password 'lumos123456' if not configured.
 */
export function seedAdminUser(): void {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) AS c FROM lumos_users').get() as { c: number };
  if (count.c > 0) return;

  const email = process.env.ADMIN_EMAIL || 'admin@lumos.local';
  const password = process.env.ADMIN_PASSWORD || 'lumos123456';
  const nickname = process.env.ADMIN_NICKNAME || 'admin';

  const userId = crypto.randomUUID();
  const now = nowISO();
  const passwordHash = hashPassword(password);

  db.prepare(
    `INSERT INTO lumos_users
     (id, email, password_hash, nickname, role, membership, image_quota_monthly, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'admin', 'monthly', 999, ?, ?)`,
  ).run(userId, email, passwordHash, nickname, now, now);

  console.log(`[auth] Seeded admin user: ${nickname} (${email})`);
}

/**
 * Refresh user balance from new-api in real time.
 */
export async function refreshUserBalance(
  userId: string,
): Promise<{ remainQuota: number; usedQuota: number }> {
  const db = getDb();
  const row = db.prepare(
    'SELECT newapi_token_id FROM lumos_users WHERE id = ?',
  ).get(userId) as { newapi_token_id: number | null } | undefined;

  if (!row?.newapi_token_id) {
    throw new Error('用户未关联 API token');
  }

  return getTokenQuota(row.newapi_token_id);
}
