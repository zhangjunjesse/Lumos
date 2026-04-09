/**
 * Shared types for the Lumos auth module.
 */

export interface LumosUser {
  id: string;
  email: string;
  nickname: string;
  avatar_url: string;
  membership: 'free' | 'monthly' | 'yearly';
  membership_expires_at: string | null;
  newapi_token_key: string;
  newapi_token_id: number | null;
  image_quota_monthly: number;
  role: 'admin' | 'user';
  status: 'active' | 'disabled' | 'deleted';
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  /** password_hash is stored in DB but never returned to clients */
  password_hash?: string;
}
