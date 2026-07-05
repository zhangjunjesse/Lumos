import { queryWeChatApi } from './api-bridge';

export interface WeChatReadinessDiagnostics {
  session_db_readable?: boolean;
  session_db_error?: string;
  message_db_total?: number;
  message_db_readable?: number;
  message_db_unreadable?: number;
  message_db_statuses?: Array<{ name?: string; role?: string; readable?: boolean; error?: string }>;
}

export interface WeChatReadinessResult {
  ok: boolean;
  message: string;
  diagnostics?: WeChatReadinessDiagnostics;
}

export async function verifyWeChatReadable(): Promise<WeChatReadinessResult> {
  const result = await queryWeChatApi<{ diagnostics?: WeChatReadinessDiagnostics }>('diagnostics', {});
  if (!result.ok) {
    return { ok: false, message: result.error.message };
  }
  const diagnostics = result.data.diagnostics || {};
  const total = diagnostics.message_db_total ?? 0;
  const readable = diagnostics.message_db_readable ?? 0;
  if (diagnostics.session_db_readable === false) {
    return {
      ok: false,
      message: `session.db 不可读：${diagnostics.session_db_error || '数据库密钥不匹配'}`,
      diagnostics,
    };
  }
  if (total <= 0) {
    return { ok: false, message: '未找到普通聊天消息库。请检查微信数据目录。', diagnostics };
  }
  if (readable <= 0) {
    const firstError = diagnostics.message_db_statuses
      ?.find((item) => item.role === 'chat' && item.readable === false && item.error)
      ?.error;
    return {
      ok: false,
      message: `消息库不可读：${firstError || `当前可读 ${readable}/${total}`}`,
      diagnostics,
    };
  }
  return { ok: true, message: `微信读取可用：session.db 可读，消息库可读 ${readable}/${total}`, diagnostics };
}
