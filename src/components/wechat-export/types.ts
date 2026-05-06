/** Shape of GET /api/wechat-export/status. Mirrors the route handler. */
export interface WeChatExportStatus {
  supported: boolean;
  platform: 'darwin' | 'win32' | string;
  message?: string;
  env?: {
    platform: 'darwin' | 'win32';
    wechat: { ok: boolean; detail: string; hint?: string; signed: 'tencent' | 'adhoc' | 'unknown' | 'not_required'; pid?: number; running?: boolean };
    sqlcipher: { ok: boolean; detail: string; hint?: string };
    xcodeCLT: { ok: boolean; detail: string; hint?: string };
    dataDir: { ok: boolean; detail: string; hint?: string; wxid?: string; root?: string; wxDir?: string };
    allOk: boolean;
    signed: 'tencent' | 'adhoc' | 'unknown' | 'not_required';
  };
  status?: {
    phase:
      | 'needs-consent'
      | 'needs-env'
      | 'needs-resign'
      | 'needs-extract'
      | 'needs-restore'
      | 'ready';
    hasConsent: boolean;
    hasKey: boolean;
    keyCount: number;
    lastExtractedAt: number | null;
  };
  consent?: {
    version: string;
    effectiveAt: string;
    summary: string[];
    body: string;
    hash: string;
    hasValidConsent: boolean;
    record: { version: string; hash: string; acceptedAt: string } | null;
  };
  mcp?: {
    installed: boolean;
    enabled: boolean;
  };
}

export interface ExtractProgressEvent {
  phase: 'starting' | 'scanning' | 'found' | 'done' | 'error';
  message: string;
  keysFound?: number;
  saltsTotal?: number;
}

export interface WeChatMessageDbDiagnostics {
  message_db_total?: number;
  message_db_readable?: number;
  message_db_unreadable?: number;
  message_db_names?: string[];
  readable_message_db_names?: string[];
  skipped_message_db_names?: string[];
  latest_message_db_mtime?: number;
  session_last_timestamp?: number;
  latest_message_timestamp?: number;
  is_detail_incomplete?: boolean;
  is_detail_stale?: boolean;
  needs_reextract?: boolean;
  error?: string;
}
