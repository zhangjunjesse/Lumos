/**
 * IM Module — Reserved Future Contracts (P2)
 *
 * 这些接口在 M1 时只写类型签名，M1-M5 不实现。
 * 飞书已有的对应代码留在 src/lib/feishu/、src/lib/feishu-auth.ts，
 * 未来若考虑迁入 IM 模块，直接 implements 这些接口即可。
 *
 * 写在独立文件而非 types.ts 是为了让 M2-M5 改 provider 的 AI
 * 不需要读这些"不会触碰"的类型。
 */

import type { IMAdapter, InboundMessage } from './types';

// ============================================================================
// P2-G: IM 文档 / 文件导入
// ============================================================================

export interface IMDocumentRef {
  token: string;
  title: string;
  type: string;
  url?: string;
  updatedAt?: number;
}

export interface IMDocumentProvider {
  listDocuments(query?: string, limit?: number): Promise<IMDocumentRef[]>;
  fetchDocumentContent(token: string): Promise<string>;
  downloadFile(fileToken: string): Promise<Buffer>;
}

// ============================================================================
// P2-H: IM 账号 OAuth 登录 lumos
// ============================================================================

export interface IMAuthSession {
  userId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  raw?: unknown;
}

export interface IMAuthProvider {
  buildAuthUrl(state: string, redirectUri: string): string;
  exchangeCodeForToken(code: string, redirectUri: string): Promise<IMAuthSession>;
  refreshSession(session: IMAuthSession): Promise<IMAuthSession>;
}

// ============================================================================
// P2-I: 群消息归档进 RAG
// ============================================================================

export interface IMArchiveQuery {
  chatId: string;
  since?: number;
  until?: number;
  limit?: number;
}

export interface IMArchiveProvider {
  listMessages(query: IMArchiveQuery): Promise<InboundMessage[]>;
}

// ============================================================================
// Type guards
// ============================================================================

export function hasDocuments(adapter: IMAdapter): adapter is IMAdapter & IMDocumentProvider {
  return typeof (adapter as Partial<IMDocumentProvider>).listDocuments === 'function';
}

export function hasAuth(adapter: IMAdapter): adapter is IMAdapter & IMAuthProvider {
  return typeof (adapter as Partial<IMAuthProvider>).buildAuthUrl === 'function';
}

export function hasArchive(adapter: IMAdapter): adapter is IMAdapter & IMArchiveProvider {
  return typeof (adapter as Partial<IMArchiveProvider>).listMessages === 'function';
}
