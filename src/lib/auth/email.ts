/**
 * Email verification code management.
 *
 * Uses nodemailer to send 6-digit codes, stored in `lumos_email_verifications`.
 * Rate-limited to one code per email per 60 seconds. Codes expire after 5 minutes.
 */

import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { getDb } from '@/lib/db/connection';

type VerificationPurpose = 'register' | 'reset_password';

const CODE_EXPIRE_MINUTES = 5;
const RESEND_COOLDOWN_SECONDS = 60;

function nowISO(): string {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

function addMinutes(minutes: number): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString().replace('T', ' ').split('.')[0];
}

function generateCode(): string {
  // Generate 6-digit numeric code
  return String(crypto.randomInt(100000, 999999));
}

function createTransporter(): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 465,
    secure: (Number(process.env.SMTP_PORT) || 465) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function checkCooldown(email: string, purpose: VerificationPurpose): void {
  const db = getDb();
  const cutoff = new Date(Date.now() - RESEND_COOLDOWN_SECONDS * 1000)
    .toISOString().replace('T', ' ').split('.')[0];

  const recent = db.prepare(
    `SELECT id FROM lumos_email_verifications
     WHERE email = ? AND purpose = ? AND created_at > ?
     LIMIT 1`,
  ).get(email, purpose, cutoff);

  if (recent) {
    throw new Error('发送过于频繁，请 60 秒后再试');
  }
}

/**
 * Send a verification code to the given email address.
 * Enforces a 60-second cooldown between sends for the same email+purpose.
 */
export async function sendVerificationCode(
  email: string,
  purpose: VerificationPurpose,
): Promise<void> {
  checkCooldown(email, purpose);

  const db = getDb();
  const code = generateCode();
  const expiresAt = addMinutes(CODE_EXPIRE_MINUTES);
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO lumos_email_verifications (id, email, code, purpose, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, email, code, purpose, expiresAt);

  const subject = purpose === 'register'
    ? `Lumos 注册验证码: ${code}`
    : `Lumos 密码重置验证码: ${code}`;

  const text = [
    `您的验证码是: ${code}`,
    `验证码将在 ${CODE_EXPIRE_MINUTES} 分钟后失效。`,
    '如果这不是您的操作，请忽略此邮件。',
  ].join('\n\n');

  const transporter = createTransporter();
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject,
    text,
  });
}

/**
 * Verify a code for the given email and purpose.
 * On success, marks the code as used and returns true.
 */
export function verifyCode(
  email: string,
  code: string,
  purpose: string,
): boolean {
  const db = getDb();
  const now = nowISO();

  const row = db.prepare(
    `SELECT id FROM lumos_email_verifications
     WHERE email = ? AND code = ? AND purpose = ? AND used = 0 AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`,
  ).get(email, code, purpose, now) as { id: string } | undefined;

  if (!row) return false;

  db.prepare(
    'UPDATE lumos_email_verifications SET used = 1 WHERE id = ?',
  ).run(row.id);

  return true;
}
