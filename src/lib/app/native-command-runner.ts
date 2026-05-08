import {
  isGoofishNativeApp,
  sendGoofishDraftFromApp,
  syncGoofishIntoApp,
  type GoofishAppSyncDeps,
} from './goofish-app-sync';
import { rejectGoofishDraftFromApp } from './goofish-draft-control';
import {
  draftConfirmationCode,
  generateGoofishReplyDraft,
  type GoofishReplyDraftGeneratorDeps,
} from './goofish-reply-draft-generator';
import type { AppManifest } from './manifest/types';
import type { AppDataStore, AppRow } from './runtime/data-store';

export interface NativeAppCommandRunResult {
  ok: boolean;
  commandId: string;
  runId: string;
  command?: string;
  message: string;
  error?: string;
}

export interface NativeAppCommandRunnerDeps {
  now?: () => number;
  goofish?: Partial<GoofishAppSyncDeps>;
  replyDraft?: GoofishReplyDraftGeneratorDeps;
}

interface AppCommandRow extends Record<string, unknown> {
  command?: string;
  risk_level?: 'read' | 'low_write' | 'high_risk';
  confirmation_required?: boolean;
  status?: 'not_connected' | 'draft' | 'pending_confirmation' | 'success' | 'failed' | 'rejected';
  result_summary?: string;
  failure_reason?: string;
  last_run_id?: string;
  updated_at?: string;
}

interface GoofishAccountRow extends Record<string, unknown> {
  account_label?: string;
  login_status?: string;
  sync_status?: string;
  last_error?: string;
}

interface BuyerConversationRow extends Record<string, unknown> {
  conversation_id?: string;
  buyer_name?: string;
  item_title?: string;
  unread_count?: number;
  last_message?: string;
  reply_status?: string;
  priority?: string;
}

interface ReplyDraftRow extends Record<string, unknown> {
  conversation_id?: string;
  buyer_name?: string;
  item_title?: string;
  incoming_message?: string;
  draft_text?: string;
  status?: 'draft' | 'pending_confirmation' | 'sent' | 'failed' | 'rejected';
  confirmation_channel?: '应用内确认' | '微信 IM 确认' | '未确认';
  confirmation_code?: string;
  confirmation_expires_at?: string;
  failure_reason?: string;
  updated_at?: string;
}

interface RunHistoryRow extends Record<string, unknown> {
  title?: string;
  status?: string;
  summary?: string;
  failure_reason?: string;
}

interface AcceptanceCheckRow extends Record<string, unknown> {
  done?: boolean;
  status?: string;
  acceptance_id?: string;
  evidence?: string;
  failure_reason?: string;
}

export async function runNativeAppCommand(input: {
  manifest: AppManifest;
  store: AppDataStore;
  rowId: string;
  confirmed: boolean;
  deps?: NativeAppCommandRunnerDeps;
}): Promise<NativeAppCommandRunResult> {
  const now = input.deps?.now?.() ?? Date.now();
  const updatedAt = new Date(now).toISOString();
  const commandRow = input.store.get<AppCommandRow>('app_command_runs', input.rowId);
  const command = normalizeCommand(commandRow?.command);
  const run = input.store.create('run_history', {
    title: command ? `执行 IM 命令：${command}` : '执行应用 IM 命令',
    status: 'running',
    summary: '正在执行应用内命令测试。',
    updated_at: updatedAt,
  });

  const finish = (
    ok: boolean,
    message: string,
    opts: { status?: AppCommandRow['status']; error?: string } = {},
  ): NativeAppCommandRunResult => {
    const status = opts.status ?? (ok ? 'success' : 'failed');
    input.store.update('run_history', run.id, {
      status: ok ? 'success' : 'failed',
      summary: message,
      failure_reason: ok ? '' : opts.error ?? message,
      updated_at: updatedAt,
    });
    if (commandRow) {
      input.store.update<AppCommandRow>('app_command_runs', commandRow.id, {
        status,
        result_summary: message,
        failure_reason: ok ? '' : opts.error ?? message,
        last_run_id: run.id,
        updated_at: updatedAt,
      });
    }
    return {
      ok,
      commandId: input.rowId,
      runId: run.id,
      command: command ?? undefined,
      message,
      error: ok ? undefined : opts.error ?? message,
    };
  };

  if (!commandRow) {
    return finish(false, '找不到要执行的应用 IM 命令模板。');
  }
  if (!command) {
    return finish(false, '命令模板缺少命令文本，无法执行。');
  }
  if (commandRow.risk_level === 'high_risk') {
    return finish(false, '高风险 IM 命令不允许在第一阶段执行。', { status: 'rejected' });
  }
  if (commandRow.confirmation_required === true && !input.confirmed) {
    return finish(false, '该 IM 命令需要用户在界面明确确认后才能执行。', {
      status: 'pending_confirmation',
    });
  }

  const genericMessage = runGenericNativeAppCommand({
    command,
    manifest: input.manifest,
    store: input.store,
    currentRunId: run.id,
  });
  if (genericMessage) {
    return finish(true, genericMessage);
  }

  if (!isGoofishNativeApp(input.manifest) || !command.startsWith('/goofish ')) {
    return finish(false, [
      `当前应用命令运行桥尚未接入命令：${command}`,
      '可先使用通用只读命令：/status、/runs、/acceptance、/help。',
    ].join('\n'));
  }

  switch (command) {
    case '/goofish status':
      return finish(true, goofishStatusSummary(input.store));
    case '/goofish unread':
      return finish(true, goofishUnreadSummary(input.store));
    case '/goofish drafts':
      return finish(true, goofishDraftsSummary(input.store));
    case '/goofish sync': {
      if (!input.confirmed) {
        return finish(false, '/goofish sync 会触发受控同步，必须由用户明确确认。', {
          status: 'pending_confirmation',
        });
      }
      const result = await syncGoofishIntoApp({
        manifest: input.manifest,
        store: input.store,
        deps: input.deps?.goofish,
      });
      return finish(result.ok, result.message, { error: result.error });
    }
    default:
      return runGoofishWriteCommand({
        command,
        manifest: input.manifest,
        store: input.store,
        now,
        goofishDeps: input.deps?.goofish,
        replyDraftDeps: input.deps?.replyDraft,
        finish,
      });
  }
}

function runGenericNativeAppCommand(input: {
  command: string;
  manifest: AppManifest;
  store: AppDataStore;
  currentRunId: string;
}): string | null {
  const command = input.command.startsWith('/') ? input.command : `/${input.command}`;
  switch (command) {
    case '/status':
      return genericStatusSummary(input.manifest, input.store, input.currentRunId);
    case '/runs':
      return genericRunsSummary(input.store, input.currentRunId);
    case '/acceptance':
      return genericAcceptanceSummary(input.store);
    case '/help':
      return genericCommandHelp(input.manifest);
    default:
      return null;
  }
}

function genericStatusSummary(
  manifest: AppManifest,
  store: AppDataStore,
  currentRunId: string,
): string {
  const runs = store
    .query<RunHistoryRow>('run_history', { limit: 50 })
    .filter((row) => row.id !== currentRunId);
  const acceptance = store.query<AcceptanceCheckRow>('acceptance_checks', { limit: 200 });
  const passed = acceptance.filter(isAcceptancePassed).length;
  const issues = acceptance.filter(isAcceptanceIssue).length;
  const latestRun = runs[0];
  return [
    `${manifest.name} 状态：`,
    `设置 ${safeCount(store, 'app_settings')} 项；运行记录 ${runs.length} 条；失败运行 ${runs.filter((row) => row.status === 'failed').length} 条。`,
    acceptance.length > 0
      ? `验收 ${passed}/${acceptance.length}，异常 ${issues} 项。`
      : '还没有验收记录。',
    `自动化 ${safeCount(store, 'app_automations')} 条；IM 命令模板 ${safeCount(store, 'app_command_runs')} 条。`,
    latestRun
      ? `最近运行：${latestRun.status ?? 'unknown'} ${latestRun.failure_reason || latestRun.summary || latestRun.title || ''}`
      : '最近运行：暂无。',
  ].join('\n');
}

function genericRunsSummary(store: AppDataStore, currentRunId: string): string {
  const runs = store
    .query<RunHistoryRow>('run_history', { limit: 8 })
    .filter((row) => row.id !== currentRunId)
    .slice(0, 5);
  if (runs.length === 0) {
    return '当前还没有可展示的运行记录。应用动作、自动化、AI 助手或 IM 命令执行后会写入这里。';
  }
  return [
    `最近 ${runs.length} 条运行记录：`,
    ...runs.map((row, index) => [
      `${index + 1}. ${row.title || '未命名运行'}`,
      row.status ? `状态：${row.status}` : '',
      row.failure_reason ? `失败：${clip(row.failure_reason, 60)}` : '',
      !row.failure_reason && row.summary ? `摘要：${clip(row.summary, 60)}` : '',
    ].filter(Boolean).join('；')),
  ].join('\n');
}

function genericAcceptanceSummary(store: AppDataStore): string {
  const rows = store.query<AcceptanceCheckRow>('acceptance_checks', { limit: 200 });
  if (rows.length === 0) {
    return '当前还没有验收清单记录。请先在应用顶部验收清单里标记通过、失败或阻塞，并填写证据。';
  }
  const passed = rows.filter(isAcceptancePassed);
  const issues = rows.filter(isAcceptanceIssue);
  const pending = rows.filter((row) => !isAcceptancePassed(row) && !isAcceptanceIssue(row));
  const issueLines = issues.slice(0, 5).map((row, index) => (
    `${index + 1}. ${row.acceptance_id || row.id}：${row.failure_reason || row.evidence || row.status || '异常'}`
  ));
  return [
    `验收进度：已通过 ${passed.length}/${rows.length}，失败或阻塞 ${issues.length}，未验证 ${pending.length}。`,
    issueLines.length > 0 ? ['需要处理的验收项：', ...issueLines].join('\n') : '当前没有失败或阻塞的验收项。',
  ].join('\n');
}

function genericCommandHelp(manifest: AppManifest): string {
  return [
    `${manifest.name} 通用应用命令：`,
    '/status - 查看设置、运行记录、验收和命令模板摘要',
    '/runs - 查看最近运行结果',
    '/acceptance - 查看验收进度和失败 / 阻塞项',
    '/help - 查看通用命令说明',
    '业务专用命令需要应用声明并由 Lumos 受控接线；高风险命令不会自动执行。',
  ].join('\n');
}

function isAcceptancePassed(row: AcceptanceCheckRow): boolean {
  return row.done === true || row.status === 'passed';
}

function isAcceptanceIssue(row: AcceptanceCheckRow): boolean {
  return row.status === 'failed' || row.status === 'blocked';
}

function safeCount(store: AppDataStore, collection: string): number {
  try {
    return store.count(collection);
  } catch {
    try {
      return store.query(collection, { limit: 1000 }).length;
    } catch {
      return 0;
    }
  }
}

async function runGoofishWriteCommand(input: {
  command: string;
  manifest: AppManifest;
  store: AppDataStore;
  now: number;
  goofishDeps?: Partial<GoofishAppSyncDeps>;
  replyDraftDeps?: GoofishReplyDraftGeneratorDeps;
  finish: (
    ok: boolean,
    message: string,
    opts?: { status?: AppCommandRow['status']; error?: string },
  ) => NativeAppCommandRunResult;
}): Promise<NativeAppCommandRunResult> {
  const query = parseGoofishDraftCommand(input.command);
  if (query === null) {
    return runGoofishConfirmCommand(input);
  }
  if (!query) {
    return input.finish(false, [
      '请使用 /goofish draft <买家名/商品名> 指定要生成草稿的买家会话。',
      goofishDraftCandidateSummary(input.store),
    ].filter(Boolean).join('\n'));
  }

  const match = findDraftConversation(input.store, query);
  if (!match.ok) {
    return input.finish(false, match.message);
  }

  const result = await generateGoofishReplyDraft({
    manifest: input.manifest,
    store: input.store,
    rowId: match.row.id,
    deps: {
      ...(input.replyDraftDeps ?? {}),
      now: () => input.now,
    },
  });
  const message = result.ok
    ? `${result.message}\n请打开闲鱼助手「回复草稿」查看；发送前仍需在应用内确认。`
    : result.message;
  return input.finish(result.ok, message, {
    error: result.error,
  });
}

async function runGoofishConfirmCommand(input: {
  command: string;
  manifest: AppManifest;
  store: AppDataStore;
  now: number;
  goofishDeps?: Partial<GoofishAppSyncDeps>;
  finish: (
    ok: boolean,
    message: string,
    opts?: { status?: AppCommandRow['status']; error?: string },
  ) => NativeAppCommandRunResult;
}): Promise<NativeAppCommandRunResult> {
  const selector = parseGoofishConfirmCommand(input.command);
  if (selector === null) {
    return runGoofishRejectCommand(input);
  }
  if (!selector) {
    return input.finish(false, [
      '请使用 /goofish confirm <草稿编号> 明确确认要发送的草稿。',
      goofishDraftsSummary(input.store),
    ].filter(Boolean).join('\n'));
  }

  const match = findDraftForConfirmation(input.store, selector);
  if (!match.ok) {
    return input.finish(false, match.message);
  }
  const expired = draftConfirmationExpired(match.row, input.now);
  if (expired) {
    return input.finish(false, [
      `草稿编号 ${draftCode(match.row)} 已过确认有效期，请重新生成草稿后再确认发送。`,
      goofishDraftsSummary(input.store),
    ].join('\n'));
  }

  const result = await sendGoofishDraftFromApp({
    manifest: input.manifest,
    store: input.store,
    rowId: match.row.id,
    confirmed: true,
    deps: input.goofishDeps,
  });
  if (result.ok) {
    input.store.update<ReplyDraftRow>('reply_drafts', match.row.id, {
      confirmation_channel: '微信 IM 确认',
      updated_at: new Date(input.now).toISOString(),
    });
  }
  const message = result.ok
    ? `${result.message}\n已通过微信 IM 命令完成显式确认。`
    : result.message;
  return input.finish(result.ok, message, {
    error: result.error,
  });
}

function runGoofishRejectCommand(input: {
  command: string;
  manifest: AppManifest;
  store: AppDataStore;
  now: number;
  finish: (
    ok: boolean,
    message: string,
    opts?: { status?: AppCommandRow['status']; error?: string },
  ) => NativeAppCommandRunResult;
}): NativeAppCommandRunResult {
  const selector = parseGoofishRejectCommand(input.command);
  if (selector === null) {
    return input.finish(false, `当前只支持 /goofish status、/goofish unread、/goofish drafts、/goofish draft <买家或商品>、/goofish confirm <草稿编号>、/goofish reject <草稿编号> 和 /goofish sync，尚未接入：${input.command}`);
  }
  if (!selector) {
    return input.finish(false, [
      '请使用 /goofish reject <草稿编号> 明确拒绝的草稿。',
      goofishDraftsSummary(input.store),
    ].filter(Boolean).join('\n'));
  }

  const match = findDraftForConfirmation(input.store, selector);
  if (!match.ok) {
    return input.finish(false, match.message);
  }

  const result = rejectGoofishDraftFromApp({
    manifest: input.manifest,
    store: input.store,
    rowId: match.row.id,
    confirmed: true,
    now: input.now,
  });
  return input.finish(result.ok, result.message, {
    error: result.error,
  });
}

function parseGoofishDraftCommand(command: string): string | null {
  if (command === '/goofish draft') return '';
  const prefix = '/goofish draft ';
  if (!command.startsWith(prefix)) return null;
  return command.slice(prefix.length).trim();
}

function parseGoofishConfirmCommand(command: string): string | null {
  if (command === '/goofish confirm') return '';
  const prefix = '/goofish confirm ';
  if (!command.startsWith(prefix)) return null;
  return command.slice(prefix.length).trim();
}

function parseGoofishRejectCommand(command: string): string | null {
  if (command === '/goofish reject') return '';
  const prefix = '/goofish reject ';
  if (!command.startsWith(prefix)) return null;
  return command.slice(prefix.length).trim();
}

function findDraftConversation(
  store: AppDataStore,
  query: string,
): { ok: true; row: AppRow<BuyerConversationRow> } | { ok: false; message: string } {
  const normalizedQuery = normalizeSearchText(query);
  const conversations = store.query<BuyerConversationRow>('buyer_conversations', { limit: 200 });
  const matches = conversations.filter((row) => (
    rowHasMessage(row)
    && searchableConversationText(row).includes(normalizedQuery)
  ));

  if (matches.length === 0) {
    return {
      ok: false,
      message: [
        `没有找到匹配“${query}”且带最近消息的买家会话。`,
        goofishDraftCandidateSummary(store),
      ].filter(Boolean).join('\n'),
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      message: [
        `找到 ${matches.length} 个匹配“${query}”的买家会话，请补充更具体的买家名或商品名。`,
        formatDraftCandidates(matches),
      ].join('\n'),
    };
  }
  return { ok: true, row: matches[0] };
}

function goofishDraftCandidateSummary(store: AppDataStore): string {
  const candidates = store
    .query<BuyerConversationRow>('buyer_conversations', { limit: 100 })
    .filter(rowHasMessage);
  if (candidates.length === 0) {
    return '当前应用内还没有可生成草稿的买家会话，请先同步闲鱼数据或在买家会话页新增记录。';
  }
  return [
    '可选最近会话：',
    formatDraftCandidates(rankDraftCandidates(candidates).slice(0, 5)),
  ].join('\n');
}

function findDraftForConfirmation(
  store: AppDataStore,
  selector: string,
): { ok: true; row: AppRow<ReplyDraftRow> } | { ok: false; message: string } {
  const normalizedSelector = normalizeSearchText(selector);
  const pendingDrafts = listPendingDrafts(store);
  const codeMatches = pendingDrafts.filter((row) => (
    normalizeSearchText(row.id) === normalizedSelector
    || normalizeSearchText(draftCode(row)) === normalizedSelector
  ));
  const matches = codeMatches.length > 0
    ? codeMatches
    : pendingDrafts.filter((row) => searchableDraftText(row).includes(normalizedSelector));

  if (matches.length === 0) {
    return {
      ok: false,
      message: [
        `没有找到匹配“${selector}”的待确认回复草稿。`,
        goofishDraftsSummary(store),
      ].filter(Boolean).join('\n'),
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      message: [
        `找到 ${matches.length} 条匹配“${selector}”的待确认草稿，请使用草稿编号确认。`,
        formatDraftRows(matches),
      ].join('\n'),
    };
  }
  return { ok: true, row: matches[0] };
}

function formatDraftCandidates(rows: Array<AppRow<BuyerConversationRow>>): string {
  return rows.map((row, index) => {
    const buyer = row.buyer_name || '买家';
    const itemTitle = row.item_title ? ` / ${row.item_title}` : '';
    const unread = Number(row.unread_count ?? 0) > 0 ? `，${Number(row.unread_count ?? 0)} 条未读` : '';
    return `${index + 1}. ${buyer}${itemTitle}${unread}`;
  }).join('\n');
}

function goofishDraftsSummary(store: AppDataStore): string {
  const drafts = listPendingDrafts(store);
  if (drafts.length === 0) {
    return '当前没有待确认的回复草稿。可以先在买家会话页生成草稿，或发送 /goofish draft <买家或商品>。';
  }
  return [
    `当前有 ${drafts.length} 条待确认回复草稿：`,
    formatDraftRows(drafts.slice(0, 8)),
    '发送前请核对内容；确认发送：/goofish confirm <草稿编号>',
  ].join('\n');
}

function listPendingDrafts(store: AppDataStore): Array<AppRow<ReplyDraftRow>> {
  return store
    .query<ReplyDraftRow>('reply_drafts', { limit: 100 })
    .filter((row) => row.status === 'draft' || row.status === 'pending_confirmation')
    .filter((row) => typeof row.draft_text === 'string' && row.draft_text.trim().length > 0);
}

function formatDraftRows(rows: Array<AppRow<ReplyDraftRow>>): string {
  return rows.map((row, index) => {
    const buyer = row.buyer_name || '买家';
    const itemTitle = row.item_title ? ` / ${row.item_title}` : '';
    const preview = row.draft_text ? `：${clip(row.draft_text, 36)}` : '';
    const expiresAt = row.confirmation_expires_at ? `（有效期至 ${formatDateTime(row.confirmation_expires_at)}）` : '';
    return `${index + 1}. ${draftCode(row)} ${buyer}${itemTitle}${preview}${expiresAt}`;
  }).join('\n');
}

function rankDraftCandidates(
  rows: Array<AppRow<BuyerConversationRow>>,
): Array<AppRow<BuyerConversationRow>> {
  return rows.slice().sort((a, b) => {
    const unreadDiff = Number(b.unread_count ?? 0) - Number(a.unread_count ?? 0);
    if (unreadDiff !== 0) return unreadDiff;
    return priorityRank(b.priority) - priorityRank(a.priority);
  });
}

function rowHasMessage(row: BuyerConversationRow): boolean {
  return typeof row.last_message === 'string' && row.last_message.trim().length > 0;
}

function searchableConversationText(row: BuyerConversationRow): string {
  return normalizeSearchText([
    row.buyer_name,
    row.item_title,
    row.conversation_id,
  ].filter(Boolean).join('\n'));
}

function searchableDraftText(row: AppRow<ReplyDraftRow>): string {
  return normalizeSearchText([
    row.id,
    draftCode(row),
    row.buyer_name,
    row.item_title,
    row.conversation_id,
  ].filter(Boolean).join('\n'));
}

function draftCode(row: AppRow<ReplyDraftRow>): string {
  const explicit = normalizeSearchText(row.confirmation_code);
  return explicit || draftConfirmationCode(row.id);
}

function draftConfirmationExpired(row: ReplyDraftRow, now: number): boolean {
  if (!row.confirmation_expires_at) return false;
  const expiresAt = Date.parse(row.confirmation_expires_at);
  return Number.isFinite(expiresAt) && expiresAt < now;
}

function normalizeSearchText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function priorityRank(value: unknown): number {
  if (value === '紧急') return 3;
  if (value === '重要') return 2;
  return 1;
}

function clip(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > max ? `${trimmed.slice(0, max)}...` : trimmed;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

function normalizeCommand(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase();
  return normalized || null;
}

function goofishStatusSummary(store: AppDataStore): string {
  const accounts = store.query<GoofishAccountRow>('goofish_accounts', { limit: 50 });
  if (accounts.length === 0) {
    return '还没有闲鱼账号状态。请先在账号页点击“同步闲鱼数据”，或到「扩展 > 闲鱼」完成安装和登录。';
  }
  const ready = accounts.filter((item) => item.login_status === 'ready').length;
  const synced = accounts.filter((item) => item.sync_status === 'success').length;
  const failed = accounts.filter((item) => item.login_status === 'failed' || item.sync_status === 'failed').length;
  const labels = accounts.slice(0, 3).map((item) => item.account_label ?? '闲鱼账号').join('、');
  return `闲鱼账号 ${accounts.length} 个，登录可用 ${ready} 个，最近同步成功 ${synced} 个，失败 ${failed} 个。账号：${labels || '暂无账号名'}。`;
}

function goofishUnreadSummary(store: AppDataStore): string {
  const conversations = store.query<BuyerConversationRow>('buyer_conversations', { limit: 100 });
  const unread = conversations.filter((item) => Number(item.unread_count ?? 0) > 0);
  const totalUnread = unread.reduce((sum, item) => sum + Number(item.unread_count ?? 0), 0);
  if (unread.length === 0) {
    return conversations.length === 0
      ? '当前应用内还没有买家会话。请先同步闲鱼数据。'
      : '当前没有未读买家会话。';
  }
  const top = unread.slice(0, 3).map((item) => {
    const buyer = item.buyer_name || '买家';
    const itemTitle = item.item_title ? ` / ${item.item_title}` : '';
    return `${buyer}${itemTitle}（${Number(item.unread_count ?? 0)} 条）`;
  }).join('；');
  return `当前有 ${unread.length} 个未读买家会话，共 ${totalUnread} 条未读。${top}`;
}
