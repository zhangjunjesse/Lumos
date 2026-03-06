/**
 * 飞书同步功能类型定义
 */

export type BindingStatus = 'active' | 'inactive' | 'expired';

export interface Binding {
  id: number;
  session_id: string;
  platform: string;
  platform_chat_id: string;
  platform_chat_name?: string;
  status: BindingStatus;
  share_link?: string;
  created_at: number;
  updated_at: number;
}

export interface SyncStats {
  totalMessages: number;
  successCount: number;
  failedCount: number;
  lastSyncAt: number | null;
}

export interface CreateBindingResponse {
  success: boolean;
  binding: Binding;
  shareLink: string;
}

export interface GetBindingResponse {
  binding: Binding | null;
}

export interface UpdateBindingResponse {
  success: boolean;
  binding: Binding;
}

export interface GetStatsResponse {
  stats: SyncStats;
}

export interface ErrorResponse {
  error: string;
  code: string;
}
