import type Database from 'better-sqlite3';

import type { OutboundMessage, SendResult } from '@/lib/im/core/types';

import type { AppRow } from './runtime/data-store';
import { createAppDataStore } from './runtime/data-store';
import { createPermissionGate, PermissionDeniedError } from './runtime/permission-gate';
import {
  getDefaultUserImTarget,
  recordLatestAppImNotification,
} from './im-bridge';

export interface SendAppImNotificationInput {
  db: Database.Database;
  appId: string;
  notificationId?: string;
  id?: string;
  title?: string;
  text?: string;
  message?: string;
  reason?: string;
  severity?: 'info' | 'success' | 'warning' | 'error';
  target?: {
    providerId?: string;
    chatId?: string;
    label?: string;
  };
  providerId?: string;
  chatId?: string;
  target_label?: string;
  /** 文件附件 — 微信 provider 已支持 sendFile。文本超 1900 字符时强烈建议改走附件。 */
  attachments?: Array<{
    name: string;
    type: string;
    size: number;
    /** base64 / data URL 字符串。和 filePath 二选一。 */
    data?: string;
    filePath?: string;
  }>;
}

export interface AppImNotificationResult {
  ok: boolean;
  appId: string;
  notificationId?: string;
  providerId?: string;
  chatId?: string;
  messageId?: string;
  status: 'sent' | 'failed';
  error?: string;
}

interface AppInstallRow {
  id: string;
  name: string;
  enabled: number;
}

interface AppNotificationRow {
  [key: string]: unknown;
  channel?: unknown;
  provider_id?: unknown;
  chat_id?: unknown;
  target_label?: unknown;
  title?: unknown;
  text?: unknown;
  message?: unknown;
  status?: unknown;
  last_error?: unknown;
}

interface SendDeps {
  now?: () => number;
  send?: (providerId: string, message: OutboundMessage) => Promise<SendResult>;
}

const APP_IM_PERMISSION = 'system:im-notification';

export async function sendAppImNotification(
  input: SendAppImNotificationInput,
  deps: SendDeps = {},
): Promise<AppImNotificationResult> {
  const now = deps.now?.() ?? Date.now();
  const imRuntime = !deps.send ? await loadImRuntime() : null;
  const send = deps.send ?? imRuntime!.sendToProvider;
  const app = loadInstalledApp(input.db, input.appId);
  if (!app) {
    return fail(input, 'failed', '应用未安装。');
  }
  if (app.enabled !== 1) {
    return fail(input, 'failed', '应用已停用，不能发送 IM 通知。');
  }

  try {
    createPermissionGate(input.db, input.appId).requireOrThrow(APP_IM_PERMISSION);
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return fail(input, 'failed', '应用没有 IM 通知权限。请在应用 manifest.permissions.system 声明并授予 im-notification。');
    }
    throw err;
  }

  const store = createAppDataStore(input.db, input.appId);
  const notificationId = input.notificationId || input.id;
  const existing = notificationId
    ? store.get<AppNotificationRow>('app_notifications', notificationId)
    : null;
  const resolvedTarget = resolveTarget(input, existing, input.db);
  const target = resolvedTarget.target;
  const messageText = formatNotificationText({
    appName: app.name,
    title: textValue(input.title) ?? textValue(existing?.title),
    text: textValue(input.text)
      ?? textValue(input.message)
      ?? textValue(existing?.text)
      ?? textValue(existing?.message)
      ?? '这是一条应用测试通知。',
    reason: textValue(input.reason),
  });

  const row = ensureNotificationRow({
    store,
    existing,
    input,
    target,
    now,
    messageText,
  });

  if (resolvedTarget.error) {
    updateNotificationFailure(store, row.id, resolvedTarget.error, now);
    appendRunHistory(store, {
      title: 'IM 通知',
      status: 'failed',
      summary: '',
      failureReason: resolvedTarget.error,
      now,
    });
    return {
      ok: false,
      appId: input.appId,
      notificationId: row.id,
      status: 'failed',
      error: resolvedTarget.error,
    };
  }

  if (!target.providerId || !target.chatId) {
    const error = '还没有绑定可发送的微信 IM 会话。请先在微信里给 Lumos/Clawbot 发一条消息，再重试。';
    updateNotificationFailure(store, row.id, error, now);
    appendRunHistory(store, {
      title: 'IM 通知',
      status: 'failed',
      summary: '',
      failureReason: error,
      now,
    });
    return {
      ok: false,
      appId: input.appId,
      notificationId: row.id,
      status: 'failed',
      error,
    };
  }

  const result = await send(target.providerId, {
    address: { providerId: target.providerId, chatId: target.chatId },
    text: messageText,
    ...(input.attachments && input.attachments.length > 0
      ? {
          attachments: input.attachments.map((a, i) => ({
            id: `${input.appId}-${now}-${i}`,
            name: a.name,
            type: a.type,
            size: a.size,
            data: a.data ?? '',
            filePath: a.filePath,
          })),
        }
      : {}),
  });

  if (!result.ok) {
    const error = productizeSendError(result);
    updateNotificationFailure(store, row.id, error, now);
    appendRunHistory(store, {
      title: 'IM 通知',
      status: 'failed',
      summary: '',
      failureReason: error,
      now,
    });
    return {
      ok: false,
      appId: input.appId,
      notificationId: row.id,
      providerId: target.providerId,
      chatId: target.chatId,
      status: 'failed',
      error,
    };
  }

  store.update('app_notifications', row.id, {
    provider_id: target.providerId,
    chat_id: target.chatId,
    target_label: target.label || textValue(row.target_label) || '默认微信用户',
    status: 'sent',
    last_error: '',
    last_message_id: result.messageId ?? '',
    last_sent_at: now,
    updated_at: now,
  });
  appendRunHistory(store, {
    title: 'IM 通知',
    status: 'success',
    summary: `已发送到 ${target.label || target.chatId}`,
    failureReason: '',
    now,
  });
  recordLatestAppImNotification({
    providerId: target.providerId,
    chatId: target.chatId,
    appId: app.id,
    appName: app.name,
    notificationId: row.id,
    title: textValue(input.title) ?? textValue(existing?.title),
    text: messageText,
    reason: textValue(input.reason),
    messageId: result.messageId,
    sentAt: now,
  }, input.db);

  return {
    ok: true,
    appId: input.appId,
    notificationId: row.id,
    providerId: target.providerId,
    chatId: target.chatId,
    messageId: result.messageId,
    status: 'sent',
  };
}

export function isAppImNotificationPermissionGranted(
  db: Database.Database,
  appId: string,
): boolean {
  return createPermissionGate(db, appId).isGranted(APP_IM_PERMISSION);
}

function loadInstalledApp(db: Database.Database, appId: string): AppInstallRow | null {
  const row = db
    .prepare('SELECT id, name, enabled FROM lumos_app_apps WHERE id = ?')
    .get(appId) as AppInstallRow | undefined;
  return row ?? null;
}

function resolveTarget(
  input: SendAppImNotificationInput,
  row: AppRow<AppNotificationRow> | null,
  db: Database.Database,
): { target: { providerId: string; chatId: string; label?: string }; error?: string } {
  const defaultTarget = getDefaultUserImTarget(db);
  const requestedProviderId = clean(input.target?.providerId)
    || clean(input.providerId)
    || clean(row?.provider_id);
  const requestedChatId = clean(input.target?.chatId)
    || clean(input.chatId)
    || clean(row?.chat_id);
  const label = clean(input.target?.label)
    || clean(input.target_label)
    || clean(row?.target_label)
    || defaultTarget?.label
    || undefined;
  if (!defaultTarget) {
    return { target: { providerId: '', chatId: '', label } };
  }
  if (
    (requestedProviderId && requestedProviderId !== defaultTarget.providerId)
    || (requestedChatId && requestedChatId !== defaultTarget.chatId)
  ) {
    return {
      target: {
        providerId: defaultTarget.providerId,
        chatId: defaultTarget.chatId,
        label: defaultTarget.label || label,
      },
      error: '应用 IM 通知第一版只能发送到用户自己的默认微信会话，不能指定其他联系人或群。',
    };
  }
  return {
    target: {
      providerId: defaultTarget.providerId,
      chatId: defaultTarget.chatId,
      label: defaultTarget.label || label,
    },
  };
}

function ensureNotificationRow(input: {
  store: ReturnType<typeof createAppDataStore>;
  existing: AppRow<AppNotificationRow> | null;
  input: SendAppImNotificationInput;
  target: { providerId: string; chatId: string; label?: string };
  now: number;
  messageText: string;
}): AppRow<AppNotificationRow> {
  if (input.existing) return input.existing;
  return input.store.create<AppNotificationRow>('app_notifications', {
    channel: 'wechat_im',
    provider_id: input.target.providerId,
    chat_id: input.target.chatId,
    target_label: input.target.label || clean(input.input.target_label) || '默认微信用户',
    title: clean(input.input.title) || '应用通知',
    text: input.messageText,
    status: 'not_connected',
    last_error: '',
    updated_at: input.now,
  });
}

function updateNotificationFailure(
  store: ReturnType<typeof createAppDataStore>,
  id: string,
  error: string,
  now: number,
): void {
  store.update('app_notifications', id, {
    status: 'failed',
    last_error: error,
    updated_at: now,
  });
}

function appendRunHistory(
  store: ReturnType<typeof createAppDataStore>,
  input: {
    title: string;
    status: 'success' | 'failed';
    summary: string;
    failureReason: string;
    now: number;
  },
): void {
  store.create('run_history', {
    title: input.title,
    status: input.status,
    summary: input.summary,
    failure_reason: input.failureReason,
    updated_at: input.now,
  });
}

function formatNotificationText(input: {
  appName: string;
  title?: string;
  text: string;
  reason?: string;
}): string {
  const lines = [
    `【${input.appName}】${input.title ? input.title : '应用通知'}`,
    input.text.trim(),
    input.reason ? `原因：${input.reason.trim()}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

function productizeSendError(result: SendResult): string {
  const raw = result.error || 'IM 通知发送失败。';
  if (/context_token/i.test(raw)) {
    return '微信 IM 会话令牌不可用。请先在微信里给 Lumos/Clawbot 发一条消息完成绑定，再重试。';
  }
  if (/no default IM provider/i.test(raw)) {
    return '还没有配置默认 IM。请先在 IM 设置里启用微信并设为默认。';
  }
  return raw;
}

function fail(
  input: SendAppImNotificationInput,
  status: 'failed',
  error: string,
): AppImNotificationResult {
  return { ok: false, appId: input.appId, notificationId: input.notificationId || input.id, status, error };
}

function textValue(value: unknown): string | undefined {
  const cleaned = clean(value);
  return cleaned || undefined;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function loadImRuntime(): Promise<{
  sendToProvider: (providerId: string, message: OutboundMessage) => Promise<SendResult>;
}> {
  const mod = await import('@/lib/im');
  return {
    sendToProvider: mod.sendToProvider,
  };
}
