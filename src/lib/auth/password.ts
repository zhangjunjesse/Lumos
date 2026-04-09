/**
 * Password hashing and verification using Node.js crypto.scryptSync.
 *
 * Storage format: `salt:hash` where both parts are hex-encoded.
 */

import crypto from 'crypto';

const SCRYPT_KEY_LENGTH = 64;

/**
 * Hash a plaintext password with a random salt.
 * Returns `salt:hash` (both hex-encoded).
 */
export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, SCRYPT_KEY_LENGTH).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verify a plaintext password against a stored `salt:hash` string.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyPassword(plain: string, stored: string): boolean {
  const [salt, storedHash] = stored.split(':');
  if (!salt || !storedHash) {
    return false;
  }

  const hash = crypto.scryptSync(plain, salt, SCRYPT_KEY_LENGTH).toString('hex');

  // Timing-safe comparison
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}
