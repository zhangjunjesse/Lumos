/**
 * Shared helpers for store modules
 */
import crypto from 'crypto';

export function genId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function now(): string {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}
