/**
 * WeChat (QClaw) Provider — Runtime Config
 *
 * 把 manifest schema 映射成强类型 QClawConfig。
 * env 兜底支持 QCLAW_HOST / QCLAW_BOT_ID / QCLAW_BOT_SECRET。
 */

export type QClawTransport = 'websocket' | 'longpoll';

export interface QClawConfig {
  qclawHost: string;
  botId: string;
  botSecret: string;
  transport: QClawTransport;
  sendPath: string;
  eventsPath: string;
  contactsPath: string;
  healthPath: string;
}

const DEFAULTS = {
  qclawHost: 'http://localhost:8080',
  transport: 'websocket' as QClawTransport,
  sendPath: '/api/messages/send',
  eventsPath: '/api/events',
  contactsPath: '/api/contacts',
  healthPath: '/api/health',
};

function pickNonEmpty(...values: Array<string | undefined>): string {
  for (const v of values) {
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed) return trimmed;
    }
  }
  return '';
}

function normalizeTransport(value: unknown): QClawTransport {
  return value === 'longpoll' ? 'longpoll' : 'websocket';
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function normalizePath(p: string): string {
  if (!p) return '';
  return p.startsWith('/') ? p : `/${p}`;
}

export function parseQClawConfig(raw: Record<string, unknown>): QClawConfig {
  return {
    qclawHost: trimTrailingSlash(
      pickNonEmpty(raw.qclaw_host as string | undefined, process.env.QCLAW_HOST) || DEFAULTS.qclawHost,
    ),
    botId: pickNonEmpty(raw.bot_id as string | undefined, process.env.QCLAW_BOT_ID),
    botSecret: pickNonEmpty(raw.bot_secret as string | undefined, process.env.QCLAW_BOT_SECRET),
    transport: normalizeTransport(raw.transport ?? DEFAULTS.transport),
    sendPath: normalizePath(pickNonEmpty(raw.send_path as string | undefined) || DEFAULTS.sendPath),
    eventsPath: normalizePath(pickNonEmpty(raw.events_path as string | undefined) || DEFAULTS.eventsPath),
    contactsPath: normalizePath(
      pickNonEmpty(raw.contacts_path as string | undefined) || DEFAULTS.contactsPath,
    ),
    healthPath: normalizePath(
      pickNonEmpty(raw.health_path as string | undefined) || DEFAULTS.healthPath,
    ),
  };
}

export function isQClawConfigValid(config: QClawConfig): boolean {
  return Boolean(config.qclawHost && config.botId && config.botSecret);
}
