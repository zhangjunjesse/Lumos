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
    dataDir: {
      ok: boolean;
      detail: string;
      hint?: string;
      wxid?: string;
      root?: string;
      wxDir?: string;
      msgDir?: string;
      messageDbDir?: string;
    };
    allOk: boolean;
    signed: 'tencent' | 'adhoc' | 'unknown' | 'not_required';
  };
  windowsPathConfig?: {
    wechatExePath?: string;
    wechatDataRoot?: string;
    updatedAt?: number;
  };
  windowsPathHint?: {
    path?: string;
    wxid?: string;
    wxDir?: string;
    msgDir?: string;
    messageDbDir?: string;
  };
  /** #40:切换微信账号/升级导致旧密钥失效的检测。仅 Windows。 */
  windowsAccountBinding?: {
    storedWxid: string | null;
    storedDirExists: boolean;
    activeWxid: string | null;
    detectedWxids: string[];
    /** 只在有硬证据时为 true —— "猜的账号≠绑定的账号"不算证据,那个猜测常错。 */
    mismatch: boolean;
    reason: 'stored-dir-missing' | 'no-binding' | null;
    /** 猜测与绑定不一致,仅供参考,不代表出错。 */
    guessDiffers?: boolean;
  };
  /** Lumos 当前认定的微信账号。由「取密钥成功」或「手动选目录」产生,不靠猜。 */
  boundAccount?: { wxid: string; boundAt: number } | null;
  /** 本机存过聊天镜像的账号(每账号一个库文件)。 */
  mirrorAccounts?: string[];
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
    /** Wall-clock ms of the last successful mirror sync, null if never synced. */
    lastSyncedAt: number | null;
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
  media_db_total?: number;
  media_db_names?: string[];
  latest_message_db_mtime?: number;
  latest_readable_message_timestamp?: number;
  latest_session_timestamp?: number;
  session_last_timestamp?: number;
  latest_message_timestamp?: number;
  is_detail_incomplete?: boolean;
  is_detail_stale?: boolean;
  needs_reextract?: boolean;
  message_db_statuses?: Array<{
    name: string;
    role: 'chat' | 'media' | string;
    readable: boolean;
    mtime?: number;
    latest_message_timestamp?: number;
    error?: string;
  }>;
  error?: string;
}
