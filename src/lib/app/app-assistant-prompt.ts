import type { AppManifest } from './manifest/types';
import type { NativeAppStatusSummary } from './status-service';

export function buildAppAssistantSystemPrompt(input: {
  manifest: AppManifest;
  systemPrompt: string;
  riskNote: string;
  enabledActions?: Array<'create_reply_draft' | 'run_self_check'>;
}): string {
  const custom = input.systemPrompt.trim();
  const risk = input.riskNote.trim();
  const canCreateReplyDraft = input.enabledActions?.includes('create_reply_draft') === true;
  const canRunSelfCheck = input.enabledActions?.includes('run_self_check') === true;
  return [
    custom || `你是 Lumos 应用「${input.manifest.name}」内的 AI 助手。`,
    '回答必须围绕当前应用，优先解释用户能在界面中完成的操作。',
    '遇到写操作、外部发送、批量修改、删除或高风险动作时，只给草稿和步骤，不要声称已经自动执行。',
    canRunSelfCheck
      ? [
        '当用户要求检查应用是否可用、重新验收、查看结构问题或生成自检证据时，可以提供“运行安装自检”动作。',
        '如果需要让界面运行自检，请在回答最后追加一个 JSON 动作块，格式必须是：',
        '[APP_ACTION]',
        '{"type":"run_self_check","reason":"用户想检查应用结构和入口是否可用"}',
        '[/APP_ACTION]',
        '这个动作只做结构、入口、权限声明和数据集合自检；不要把它说成外部账号、IM、定时任务或真实业务已经通过。',
      ].join('\n')
      : '',
    canCreateReplyDraft
      ? [
        '当用户要求为买家消息生成回复时，只能生成回复草稿。',
        '如果需要让界面保存草稿，请在回答最后追加一个 JSON 动作块，格式必须是：',
        '[APP_ACTION]',
        '{"type":"create_reply_draft","buyer_name":"买家名","item_title":"商品标题","conversation_id":"可选会话ID","incoming_message":"买家消息","draft_text":"回复草稿","reason":"为什么建议保存这条草稿","risk_note":"风险说明"}',
        '[/APP_ACTION]',
        'reason 必须说明为什么建议这个动作，risk_note 必须说明不能自动发送或需要用户确认的原因。',
        '不要声称已经发送；用户还需要在界面点击“保存回复草稿”。',
      ].join('\n')
      : '',
    risk ? `应用风险边界：${risk}` : '',
  ].filter(Boolean).join('\n');
}

export function buildAppAssistantUserPrompt(input: {
  appName: string;
  status?: NativeAppStatusSummary | null;
  userMessage: string;
  riskNote: string;
  appContext?: string;
}): string {
  return [
    `应用：${input.appName}`,
    input.status
      ? `当前状态：${input.status.label}。${input.status.message}`
      : '当前状态：未加载。',
    input.status
      ? `设置数量：${input.status.counts.settings}；运行记录：${input.status.counts.runHistory}；失败数量：${input.status.counts.failedRuns}。`
      : '',
    input.status && input.status.counts.acceptanceTotal > 0
      ? `验收进度：${input.status.counts.acceptancePassed}/${input.status.counts.acceptanceTotal}；验收异常：${input.status.counts.acceptanceIssues}。`
      : '',
    input.status?.latestRun
      ? `最近运行：${input.status.latestRun.status} ${input.status.latestRun.failureReason ?? input.status.latestRun.summary ?? ''}`
      : '',
    input.riskNote.trim() ? `风险边界：${input.riskNote.trim()}` : '',
    input.appContext?.trim() ? `应用数据上下文：\n${input.appContext.trim()}` : '',
    `用户问题：${input.userMessage}`,
  ].filter(Boolean).join('\n');
}
