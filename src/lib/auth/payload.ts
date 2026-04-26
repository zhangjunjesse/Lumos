/**
 * Compose the authenticated-user JSON sent to the Pro client.
 *
 * The shape mirrors ProAuthUser in src/hooks/useProAuth.ts and is shared by
 * /api/auth/me and /api/auth/pro-heartbeat so the client sees identical
 * fields on first load and on every 60-second refresh.
 */

import type { CustomProviderFlags } from './custom-provider-capabilities';
import type { LumosUser } from './types';

export interface AuthPayload {
  id: string;
  email: string;
  nickname: string;
  membership: 'free' | 'monthly' | 'yearly';
  membership_expires_at: string | null;
  role: 'admin' | 'user';
  balance: number;
  used_quota: number;
  allow_custom_providers: CustomProviderFlags;
  balance_error?: string;
  // Backward compat for sidebar / header code that reads the old shape.
  username: string;
  display_name: string;
  quota: number;
  group: string;
}

export function composeAuthPayload(
  user: LumosUser,
  balance: number,
  usedQuota: number,
  flags: CustomProviderFlags,
  balanceError?: string,
): AuthPayload {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    membership: user.membership,
    membership_expires_at: user.membership_expires_at,
    role: user.role || 'user',
    balance,
    used_quota: usedQuota,
    allow_custom_providers: flags,
    balance_error: balanceError,
    username: user.email,
    display_name: user.nickname || user.email,
    quota: balance,
    group: user.membership,
  };
}
