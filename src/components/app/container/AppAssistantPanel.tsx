'use client';

import * as React from 'react';
import { ListChecks, Save, Send } from 'lucide-react';

import { BottomChatPanel } from '@/components/layout/BottomChatPanel';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  parseAppAssistantActions,
  stripAppAssistantActionBlocks,
  supportsReplyDraftActions,
  type AppAssistantAction,
  type CreateReplyDraftAction,
  type RunSelfCheckAction,
} from '@/lib/app/app-assistant-actions';
import {
  buildAppAssistantSystemPrompt,
  buildAppAssistantUserPrompt,
} from '@/lib/app/app-assistant-prompt';
import type { AppManifest } from '@/lib/app/manifest/types';
import type { NativeAppStatusSummary } from '@/lib/app/status-service';

interface AppAssistantPanelProps {
  appId: string;
  manifest: AppManifest;
  status?: NativeAppStatusSummary | null;
}

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  error?: boolean;
};

interface AppSettingRow {
  ai_system_prompt?: unknown;
  risk_note?: unknown;
}

interface AssistantMessageRow {
  id: string;
  role?: unknown;
  text?: unknown;
  error?: unknown;
}

type AppDataRow = Record<string, unknown> & { id?: string };

interface SelfCheckResponse {
  ok?: boolean;
  message?: string;
  runId?: string;
  status?: 'success' | 'failed';
  checked?: string[];
  failures?: string[];
}

export function AppAssistantPanel({
  appId,
  manifest,
  status,
}: AppAssistantPanelProps): React.ReactElement {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [systemPrompt, setSystemPrompt] = React.useState('');
  const [riskNote, setRiskNote] = React.useState('');
  const [assistantContext, setAssistantContext] = React.useState('');
  const [savingActionKey, setSavingActionKey] = React.useState('');
  const [savedActionKeys, setSavedActionKeys] = React.useState<Set<string>>(() => new Set());
  const replyDraftActionsEnabled = React.useMemo(
    () => supportsReplyDraftActions(manifest),
    [manifest],
  );
  const enabledActionTypes = React.useMemo(
    () => new Set<AppAssistantAction['type']>([
      'run_self_check',
      ...(replyDraftActionsEnabled ? (['create_reply_draft'] as const) : []),
    ]),
    [replyDraftActionsEnabled],
  );

  React.useEffect(() => {
    let cancelled = false;
    async function loadAssistantState() {
      try {
        const [settingsRes, messagesRes] = await Promise.all([
          fetch(`/api/apps/${encodeURIComponent(appId)}/data?${new URLSearchParams({
            collection: 'app_settings',
            limit: '1',
          })}`, { cache: 'no-store' }),
          fetch(`/api/apps/${encodeURIComponent(appId)}/data?${new URLSearchParams({
            collection: 'assistant_messages',
            limit: '30',
          })}`, { cache: 'no-store' }),
        ]);
        if (cancelled) return;

        if (settingsRes.ok) {
          const settingsJson = (await settingsRes.json()) as { rows?: AppSettingRow[] };
          const latest = settingsJson.rows?.[0];
          if (latest) {
            setSystemPrompt(typeof latest.ai_system_prompt === 'string' ? latest.ai_system_prompt : '');
            setRiskNote(typeof latest.risk_note === 'string' ? latest.risk_note : '');
          }
        }

        if (messagesRes.ok) {
          const messagesJson = (await messagesRes.json()) as { rows?: AssistantMessageRow[] };
          const loaded = (messagesJson.rows ?? [])
            .filter((row): row is AssistantMessageRow & { role: 'user' | 'assistant'; text: string } => (
              (row.role === 'user' || row.role === 'assistant')
              && typeof row.text === 'string'
            ))
            .reverse()
            .map((row) => ({
              id: row.id,
              role: row.role,
              text: row.text,
              error: row.error === true,
            }));
          setMessages(loaded);
        }

        const context = await loadAppAssistantContext(appId, {
          includeGoofish: replyDraftActionsEnabled,
        });
        if (!cancelled) setAssistantContext(context);
      } catch {
        // assistant state is optional; keep the assistant usable
      }
    }
    if (appId) void loadAssistantState();
    return () => {
      cancelled = true;
    };
  }, [appId, replyDraftActionsEnabled]);

  const send = React.useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: 'user',
      text,
    };
    setMessages((current) => [...current, userMessage]);
    void persistAssistantMessage(appId, userMessage);
    setInput('');
    setSending(true);
    try {
      const res = await fetch(`/api/apps/${encodeURIComponent(appId)}/ai/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: buildAppAssistantUserPrompt({
            appName: manifest.name,
            status,
            userMessage: text,
            riskNote,
            appContext: assistantContext,
          }),
          opts: {
            system: buildAppAssistantSystemPrompt({
              manifest,
              systemPrompt,
              riskNote,
              enabledActions: Array.from(enabledActionTypes),
            }),
            temperature: 0.2,
            maxTokens: 1400,
          },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || !json.text) {
        throw new Error(json.error ?? `AI 请求失败：HTTP ${res.status}`);
      }
      const assistantMessage: ChatMessage = {
        id: `${Date.now()}-assistant`,
        role: 'assistant',
        text: json.text ?? '',
      };
      setMessages((current) => [...current, assistantMessage]);
      void persistAssistantMessage(appId, assistantMessage);
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: `${Date.now()}-assistant-error`,
        role: 'assistant',
        text: (error as Error).message,
        error: true,
      };
      setMessages((current) => [...current, errorMessage]);
      void persistAssistantMessage(appId, errorMessage);
    } finally {
      setSending(false);
    }
  }, [appId, assistantContext, enabledActionTypes, input, manifest, riskNote, sending, status, systemPrompt]);

  const saveReplyDraft = React.useCallback(async (
    actionKey: string,
    action: CreateReplyDraftAction,
  ) => {
    if (savingActionKey || savedActionKeys.has(actionKey)) return;
    setSavingActionKey(actionKey);
    try {
      const res = await fetch(`/api/apps/${encodeURIComponent(appId)}/data?${new URLSearchParams({
        collection: 'reply_drafts',
      })}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: action.conversationId ?? '',
          buyer_name: action.buyerName,
          item_title: action.itemTitle ?? '',
          incoming_message: action.incomingMessage ?? '',
          draft_text: action.draftText,
          status: 'draft',
          confirmation_channel: '未确认',
          risk_note: action.riskNote ?? 'AI 草稿已保存；发送前必须由用户确认。',
          updated_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? `保存草稿失败：HTTP ${res.status}`);
      }
      setSavedActionKeys((current) => new Set(current).add(actionKey));
      void persistAssistantRunHistory(appId, {
        title: 'AI 助手保存回复草稿',
        status: 'success',
        summary: `已保存给 ${action.buyerName} 的回复草稿，发送前仍需用户确认。`,
        failure_reason: '',
        action_type: 'create_reply_draft',
        action_reason: action.reason ?? '',
        updated_at: new Date().toISOString(),
      });
      const savedMessage: ChatMessage = {
        id: `${Date.now()}-assistant-saved-draft`,
        role: 'assistant',
        text: `已保存一条回复草稿：${action.buyerName}。发送前仍需要你在应用内确认。`,
      };
      setMessages((current) => [...current, savedMessage]);
      void persistAssistantMessage(appId, savedMessage);
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: `${Date.now()}-assistant-save-draft-error`,
        role: 'assistant',
        text: (error as Error).message,
        error: true,
      };
      void persistAssistantRunHistory(appId, {
        title: 'AI 助手保存回复草稿',
        status: 'failed',
        summary: `保存给 ${action.buyerName} 的回复草稿失败。`,
        failure_reason: errorMessage.text,
        action_type: 'create_reply_draft',
        action_reason: action.reason ?? '',
        updated_at: new Date().toISOString(),
      });
      setMessages((current) => [...current, errorMessage]);
      void persistAssistantMessage(appId, errorMessage);
    } finally {
      setSavingActionKey('');
    }
  }, [appId, savedActionKeys, savingActionKey]);

  const runSelfCheck = React.useCallback(async (
    actionKey: string,
    action: RunSelfCheckAction,
  ) => {
    if (savingActionKey) return;
    setSavingActionKey(actionKey);
    try {
      const res = await fetch(
        `/api/apps/${encodeURIComponent(appId)}/native-actions/app/run-self-check`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: action.reason ?? '' }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as SelfCheckResponse;
      if (!res.ok) {
        throw new Error(json.message ?? `安装自检请求失败：HTTP ${res.status}`);
      }
      const failed = json.ok === false || json.status === 'failed';
      const detail = failed
        ? (json.failures ?? []).slice(0, 5).join('\n')
        : `通过检查：${json.checked?.length ?? 0} 项`;
      const selfCheckMessage: ChatMessage = {
        id: `${Date.now()}-assistant-self-check`,
        role: 'assistant',
        text: [
          failed
            ? `安装自检失败：${json.message ?? '存在未通过项。'}`
            : `安装自检通过：${json.message ?? '结构和入口自检通过。'}`,
          json.runId ? `运行记录：${json.runId}` : '',
          detail,
        ].filter(Boolean).join('\n'),
        error: failed,
      };
      setMessages((current) => [...current, selfCheckMessage]);
      void persistAssistantMessage(appId, selfCheckMessage);
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: `${Date.now()}-assistant-self-check-error`,
        role: 'assistant',
        text: (error as Error).message,
        error: true,
      };
      setMessages((current) => [...current, errorMessage]);
      void persistAssistantMessage(appId, errorMessage);
    } finally {
      setSavingActionKey('');
    }
  }, [appId, savingActionKey]);

  return (
    <BottomChatPanel title={`${manifest.name} AI 助手`} expandedHeight="h-[min(46vh,34rem)]">
      {({ collapsed, expand }) => (
        <div className="flex h-full flex-col gap-3 px-1">
          {!collapsed ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-3">
              {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  可以询问当前应用状态、设置、运行结果和下一步操作。
                </div>
              ) : (
                <div className="grid gap-2 py-2">
                  {messages.map((message) => {
                    const actions = message.role === 'assistant' && !message.error
                      ? parseAppAssistantActions(message.text)
                        .filter((action) => enabledActionTypes.has(action.type))
                      : [];
                    const displayText = actions.length > 0
                      ? stripAppAssistantActionBlocks(message.text) || defaultActionText(actions)
                      : message.text;
                    return (
                      <div
                        key={message.id}
                        className={[
                          'max-w-[84%] rounded-md border px-3 py-2 text-sm leading-6',
                          message.role === 'user'
                            ? 'ml-auto bg-primary text-primary-foreground'
                            : message.error
                              ? 'bg-destructive/10 text-destructive'
                              : 'bg-muted/50',
                        ].join(' ')}
                      >
                        <div className="whitespace-pre-wrap">{displayText}</div>
                        {actions.length > 0 ? (
                          <div className="mt-2 grid gap-2">
                            {actions.map((action, actionIndex) => {
                              const actionKey = `${message.id}:${actionIndex}`;
                              const saved = savedActionKeys.has(actionKey);
                              return (
                                <div
                                  key={actionKey}
                                  className="rounded-md border bg-background/60 p-2 text-xs text-muted-foreground"
                                >
                                  <div className="font-medium text-foreground">
                                    受控动作：{actionTitle(action)}
                                  </div>
                                  <div className="mt-1">
                                    建议原因：{actionReason(action)}
                                  </div>
                                  <div>
                                    执行状态：{actionExecutionState(action, {
                                      saving: savingActionKey === actionKey,
                                      saved,
                                    })}
                                  </div>
                                  {action.type === 'create_reply_draft' ? (
                                    <div>
                                      对象：{action.buyerName}
                                      {action.itemTitle ? ` / ${action.itemTitle}` : ''}
                                    </div>
                                  ) : null}
                                  {action.type === 'create_reply_draft' && action.riskNote ? (
                                    <div>风险说明：{action.riskNote}</div>
                                  ) : null}
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {action.type === 'create_reply_draft' ? (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => void saveReplyDraft(actionKey, action)}
                                        disabled={saved || savingActionKey === actionKey}
                                      >
                                        <Save />
                                        {saved
                                          ? '已保存草稿'
                                          : savingActionKey === actionKey
                                            ? '保存中…'
                                            : '保存回复草稿'}
                                      </Button>
                                    ) : (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => void runSelfCheck(actionKey, action)}
                                        disabled={savingActionKey === actionKey}
                                      >
                                        <ListChecks />
                                        {savingActionKey === actionKey ? '自检中…' : '运行安装自检'}
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
          <form
            className="flex items-end gap-2 px-3 pb-1"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onFocus={expand}
              rows={collapsed ? 1 : 3}
              placeholder="问应用助手…"
              className="min-h-10 resize-none text-sm"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <Button type="submit" size="icon" disabled={!input.trim() || sending} aria-label="发送">
              <Send />
            </Button>
          </form>
        </div>
      )}
    </BottomChatPanel>
  );
}

async function persistAssistantMessage(appId: string, message: ChatMessage): Promise<void> {
  try {
    await fetch(`/api/apps/${encodeURIComponent(appId)}/data?${new URLSearchParams({
      collection: 'assistant_messages',
    })}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: message.role,
        text: message.text,
        error: message.error === true,
        created_at: new Date().toISOString(),
      }),
    });
  } catch {
    // Persistence should never block the visible assistant answer.
  }
}

async function persistAssistantRunHistory(
  appId: string,
  row: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch(`/api/apps/${encodeURIComponent(appId)}/data?${new URLSearchParams({
      collection: 'run_history',
    })}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row),
    });
  } catch {
    // Action result history improves traceability, but should not block the UI.
  }
}

async function loadAppAssistantContext(
  appId: string,
  options: { includeGoofish: boolean },
): Promise<string> {
  const [runHistory, acceptanceChecks, automations, commands] = await Promise.all([
    fetchCollectionRows(appId, 'run_history', 5),
    fetchCollectionRows(appId, 'acceptance_checks', 8),
    fetchCollectionRows(appId, 'app_automations', 5),
    fetchCollectionRows(appId, 'app_command_runs', 5),
  ]);
  const sections = [
    formatRows('最近运行结果', runHistory, (row) => [
      stringField(row, 'title') || '未命名运行',
      stringField(row, 'status') ? `状态：${stringField(row, 'status')}` : '',
      stringField(row, 'summary') ? `摘要：${clip(stringField(row, 'summary'), 100)}` : '',
      stringField(row, 'failure_reason')
        ? `失败原因：${clip(stringField(row, 'failure_reason'), 100)}`
        : '',
      fieldText(row, 'updated_at') ? `更新时间：${fieldText(row, 'updated_at')}` : '',
    ]),
    formatRows('验收记录', acceptanceChecks, (row) => [
      stringField(row, 'acceptance_id') || row.id || '未命名验收项',
      stringField(row, 'status') ? `状态：${stringField(row, 'status')}` : '',
      stringField(row, 'evidence') ? `证据：${clip(stringField(row, 'evidence'), 90)}` : '',
      stringField(row, 'failure_reason')
        ? `失败原因：${clip(stringField(row, 'failure_reason'), 90)}`
        : '',
      stringField(row, 'evidence_run_id') ? `关联运行：${stringField(row, 'evidence_run_id')}` : '',
    ]),
    formatRows('自动化状态', automations, (row) => [
      stringField(row, 'title') || '未命名自动化',
      stringField(row, 'native_action') ? `动作：${stringField(row, 'native_action')}` : '',
      fieldText(row, 'enabled') ? `启用：${fieldText(row, 'enabled')}` : '',
      stringField(row, 'last_status') ? `最近状态：${stringField(row, 'last_status')}` : '',
      stringField(row, 'schedule_status') ? `调度状态：${stringField(row, 'schedule_status')}` : '',
      stringField(row, 'schedule_error') ? `调度失败：${clip(stringField(row, 'schedule_error'), 80)}` : '',
    ]),
    formatRows('IM 命令状态', commands, (row) => [
      stringField(row, 'command') || '未命名命令',
      stringField(row, 'status') ? `状态：${stringField(row, 'status')}` : '',
      stringField(row, 'risk_level') ? `风险：${stringField(row, 'risk_level')}` : '',
      stringField(row, 'result_summary') ? `结果：${clip(stringField(row, 'result_summary'), 90)}` : '',
      stringField(row, 'failure_reason')
        ? `失败原因：${clip(stringField(row, 'failure_reason'), 90)}`
        : '',
    ]),
  ].filter(Boolean);
  if (options.includeGoofish) {
    const goofishContext = await loadGoofishAssistantContext(appId);
    if (goofishContext) sections.push(goofishContext);
  }
  return sections.join('\n');
}

async function loadGoofishAssistantContext(appId: string): Promise<string> {
  const [conversations, drafts, itemMarks] = await Promise.all([
    fetchCollectionRows(appId, 'buyer_conversations', 5),
    fetchCollectionRows(appId, 'reply_drafts', 5),
    fetchCollectionRows(appId, 'item_marks', 5),
  ]);
  const sections = [
    formatRows('最近买家会话', conversations, (row) => [
      stringField(row, 'buyer_name') || '未命名买家',
      stringField(row, 'item_title') ? `商品：${stringField(row, 'item_title')}` : '',
      numberField(row, 'unread_count') > 0 ? `未读：${numberField(row, 'unread_count')}` : '',
      stringField(row, 'reply_status') ? `状态：${stringField(row, 'reply_status')}` : '',
      stringField(row, 'priority') ? `优先级：${stringField(row, 'priority')}` : '',
      stringField(row, 'last_message') ? `最近消息：${clip(stringField(row, 'last_message'), 80)}` : '',
    ]),
    formatRows('最近回复草稿', drafts, (row) => [
      stringField(row, 'buyer_name') || '未命名买家',
      stringField(row, 'status') ? `状态：${stringField(row, 'status')}` : '',
      stringField(row, 'draft_text') ? `草稿：${clip(stringField(row, 'draft_text'), 100)}` : '',
    ]),
    formatRows('最近商品标记', itemMarks, (row) => [
      stringField(row, 'item_title') || '未命名商品',
      stringField(row, 'status') ? `标记：${stringField(row, 'status')}` : '',
      stringField(row, 'notes') ? `备注：${clip(stringField(row, 'notes'), 80)}` : '',
    ]),
  ].filter(Boolean);
  return sections.join('\n');
}

async function fetchCollectionRows(
  appId: string,
  collection: string,
  limit: number,
): Promise<AppDataRow[]> {
  try {
    const res = await fetch(`/api/apps/${encodeURIComponent(appId)}/data?${new URLSearchParams({
      collection,
      limit: String(limit),
    })}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = (await res.json()) as { rows?: AppDataRow[] };
    return Array.isArray(json.rows) ? json.rows : [];
  } catch {
    return [];
  }
}

function formatRows(
  title: string,
  rows: AppDataRow[],
  describe: (row: AppDataRow) => string[],
): string {
  if (rows.length === 0) return '';
  return [
    `${title}：`,
    ...rows.map((row, index) => {
      const text = describe(row).filter(Boolean).join('；');
      return `${index + 1}. ${text}`;
    }),
  ].join('\n');
}

function stringField(row: AppDataRow, field: string): string {
  const value = row[field];
  return typeof value === 'string' ? value.trim() : '';
}

function fieldText(row: AppDataRow, field: string): string {
  const value = row[field];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  return '';
}

function numberField(row: AppDataRow, field: string): number {
  const value = row[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function defaultActionText(actions: AppAssistantAction[]): string {
  if (actions.some((action) => action.type === 'run_self_check')) {
    return '我准备了一个可运行的安装自检动作。';
  }
  if (actions.some((action) => action.type === 'create_reply_draft')) {
    return '我准备了一条可保存的回复草稿。';
  }
  return '我准备了一个可执行动作。';
}

function actionTitle(action: AppAssistantAction): string {
  if (action.type === 'run_self_check') return '运行安装自检';
  if (action.type === 'create_reply_draft') return '保存回复草稿';
  return '应用动作';
}

function actionReason(action: AppAssistantAction): string {
  if (action.type === 'run_self_check') {
    return action.reason || '用户要求检查应用结构、入口、权限声明或数据集合是否可用。';
  }
  return action.reason || '基于当前应用上下文生成本地草稿，等待用户确认后再进入发送流程。';
}

function actionExecutionState(
  action: AppAssistantAction,
  state: { saving: boolean; saved: boolean },
): string {
  if (state.saving) return action.type === 'run_self_check' ? '自检中' : '保存中';
  if (state.saved) return '已执行，结果已写入运行记录';
  return '待用户点击确认，不会自动执行';
}
