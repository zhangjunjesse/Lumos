/** Shape of GET /api/wechat-export/status. Mirrors the route handler. */
export interface WeChatExportStatus {
  supported: boolean;
  platform: string;
  message?: string;
  env?: {
    wechat: { ok: boolean; detail: string; hint?: string; signed: 'tencent' | 'adhoc' | 'unknown' };
    sqlcipher: { ok: boolean; detail: string; hint?: string };
    xcodeCLT: { ok: boolean; detail: string; hint?: string };
    dataDir: { ok: boolean; detail: string; hint?: string; wxid?: string };
    allOk: boolean;
    signed: 'tencent' | 'adhoc' | 'unknown';
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
