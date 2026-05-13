/**
 * Cloud-speech adapter — bridges desktop transcribeAudioAttachment to the
 * lumos-web cloud ASR proxy (volcengine ASR by default).
 *
 * Flow:
 *   1. POST audio bytes (multipart) to /api/cloud/audio-temp → get signed temp URL
 *   2. POST { remote_provider_id, audio_url, options } to /api/cloud/speech/transcribe
 *   3. Cloud submits to volcengine, polls query, returns { text, duration_seconds, charged_amount }
 *
 * All calls carry the lumos-web session cookie (lumos_session) so server can
 * scope billing / provider key to the right user. We never see the volcengine
 * key here — the desktop is intentionally a thin client.
 */

import type { IMFileAttachment } from '../types';
import type { TranscribeResult } from '../speech';

export interface CloudSpeechProvider {
  /** local api_providers.id */
  localProviderId: string;
  /** lumos-web lumos_speech_providers.id (UUID string, used to attribute billing) */
  remoteProviderId: string;
  /** e.g. 'volcengine-asr-v1' / 'volcengine-asr-v2' */
  providerType: string;
  /** display price (元/秒); UI-only, real billing is server-side */
  pricePerSecond?: number;
}

export async function resolveCloudSpeechProvider(): Promise<CloudSpeechProvider | null> {
  const { getDb } = await import('@/lib/db/connection');
  const db = getDb();
  const overrideRow = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('provider_override:speech') as { value?: string } | undefined;
  const localProviderId = overrideRow?.value?.trim() ?? '';
  if (!localProviderId) return null;

  const providerRow = db
    .prepare(
      "SELECT id, provider_type, extra_env FROM api_providers WHERE id = ? AND provider_origin = 'system'",
    )
    .get(localProviderId) as { id: string; provider_type: string; extra_env?: string } | undefined;
  if (!providerRow) return null;

  const { getRemoteSpeechProviderId } = await import('@/lib/cloud/provisioner');
  const remoteId = getRemoteSpeechProviderId(db, providerRow.id);
  if (!remoteId) return null;

  let pricePerSecond: number | undefined;
  if (providerRow.extra_env) {
    try {
      const env = JSON.parse(providerRow.extra_env) as Record<string, string>;
      const raw = env.LUMOS_SPEECH_PRICE_PER_SECOND;
      const parsed = typeof raw === 'string' ? Number.parseFloat(raw) : NaN;
      if (Number.isFinite(parsed)) pricePerSecond = parsed;
    } catch { /* malformed env — skip */ }
  }

  return {
    localProviderId: providerRow.id,
    remoteProviderId: remoteId,
    providerType: providerRow.provider_type,
    pricePerSecond,
  };
}

export async function transcribeViaCloudProxy(
  attachment: IMFileAttachment,
  bytes: Buffer,
  provider: CloudSpeechProvider,
): Promise<TranscribeResult> {
  const { getActiveWebSessionToken } = await import('@/lib/auth/user-service');
  const webToken = getActiveWebSessionToken();
  if (!webToken) {
    throw new Error('未登录 Lumos 云账户，无法调用语音转写。请先登录。');
  }

  const webBase = process.env.LUMOS_WEB_URL || 'https://lumos.miki.zj.cn';
  const cookie = `lumos_session=${webToken}`;

  // Step 1: upload audio to lumos-web temp store, get signed URL.
  const audioUrl = await uploadAudioTemp(webBase, cookie, attachment, bytes);

  // Step 2: submit transcribe job + wait for result (server polls volcengine).
  const transcribeRes = await fetch(`${webBase}/api/cloud/speech/transcribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      remote_provider_id: provider.remoteProviderId,
      audio_url: audioUrl,
      options: { language: 'zh-CN', enable_punc: true, enable_itn: true },
    }),
  });

  const data = (await transcribeRes.json().catch(() => ({}))) as {
    ok?: boolean;
    text?: string;
    duration_seconds?: number;
    charged_amount?: number;
    request_id?: string;
    provider_type?: string;
    status?: string;
    error?: string;
    message?: string;
    code?: string;
  };

  if (!transcribeRes.ok || data.ok === false) {
    if (data.error === 'INSUFFICIENT_BALANCE') {
      throw new Error(data.message || 'Lumos 余额不足，请先充值');
    }
    if (transcribeRes.status === 401) {
      // Same AUTH_EXPIRED marker as uploadAudioTemp; lets the UI route
      // failures to "重新登录" instead of treating it as ASR error.
      throw new Error(
        `AUTH_EXPIRED · Lumos 云会话已过期：${data.message ?? data.error ?? '请重新登录'}`,
      );
    }
    throw new Error(data.message || data.error || `云端转写失败 (${transcribeRes.status})`);
  }

  const text = typeof data.text === 'string' ? data.text : '';
  return {
    text,
    empty: text.trim().length === 0,
    duration_seconds: typeof data.duration_seconds === 'number' ? data.duration_seconds : undefined,
    charged_amount: typeof data.charged_amount === 'number' ? data.charged_amount : undefined,
    request_id: typeof data.request_id === 'string' ? data.request_id : undefined,
    provider: data.provider_type || provider.providerType,
  };
}

async function uploadAudioTemp(
  webBase: string,
  cookie: string,
  attachment: IMFileAttachment,
  bytes: Buffer,
): Promise<string> {
  const name = attachment.name || 'voice.bin';
  const mimeType = attachment.type || 'application/octet-stream';
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), name);
  form.append('mime_type', mimeType);
  form.append('name', name);

  const res = await fetch(`${webBase}/api/cloud/audio-temp`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
    },
    body: form,
  });
  // lumos-web wraps responses as `{ success, data: {...} }`; speech/transcribe
  // is the only outlier using `{ ok, ... }`. Read the wrapped shape here.
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: { url?: string };
    error?: string;
    message?: string;
  };
  const url = json.data?.url;
  if (!res.ok || !url) {
    if (res.status === 413) {
      throw new Error(
        `临时音频上传失败 (413)：${bytes.length} 字节超过反代 client_max_body_size。` +
          `请确认 lumos-web 的 nginx server 块已设置 \`client_max_body_size 0;\` 并完成 reload。`,
      );
    }
    if (res.status === 401) {
      // Session-expired marker: stable token ("AUTH_EXPIRED") so probe
      // and transcribe can route the failure to the auth step instead
      // of treating it as a generic upload error.
      throw new Error(
        `AUTH_EXPIRED · Lumos 云会话已过期：${json.error ?? json.message ?? '请重新登录'}`,
      );
    }
    throw new Error(json.message || json.error || `临时音频上传失败 (${res.status})`);
  }
  return url;
}
