import { CHAT_PANEL_EXPAND_EVENT } from '@/components/layout/BottomChatPanel';

const CHAT_DRAFT_EVENT = 'lumos:chat-draft';

export interface FailedJobAskAiInput {
  jobId: string;
  jobStatus: string;
  jobStage?: string | null;
  inputTitle?: string | null;
  failureReason?: string | null;
  failureStage?: string | null;
}

export function buildFailedJobAskAiPrompt(input: FailedJobAskAiInput): string {
  const lines: string[] = [];
  const titleFragment = input.inputTitle ? `「${input.inputTitle}」的` : '';
  lines.push(`帮我看一下${titleFragment}这条任务为什么${input.jobStatus === 'cancelled' ? '被取消' : '失败'}，下一步怎么处理？`);
  lines.push('');
  lines.push(`- 任务 id: ${input.jobId}`);
  if (input.jobStatus) lines.push(`- 当前状态: ${input.jobStatus}`);
  if (input.jobStage) lines.push(`- 最后阶段: ${input.jobStage}`);
  if (input.failureStage) lines.push(`- 失败阶段: ${input.failureStage}`);
  if (input.failureReason) lines.push(`- 失败原因: ${input.failureReason}`);
  lines.push('');
  lines.push('如果可以，请用 list_image_jobs / get_ecommerce_status 等工具核实最新状态，再给我具体的处理建议。');
  return lines.join('\n');
}

export function buildOnboardingAskAiPrompt(): string {
  return [
    '我是第一次用电商助手，还没有任何商品输入。',
    '请用 get_ecommerce_status 确认下当前状态，然后给我一份从 0 到 1 的步骤说明：',
    '1) 在工坊新建商品输入时需要哪些字段、主图/参考图各放几张；',
    '2) 跑一次完整任务大概多久、会消耗哪些配额；',
    '3) 第一次出图想先小成本试水，应该选 1:1 还是 3:4，预设要怎么挑。',
  ].join('\n');
}

export function dispatchAskAi(prompt: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CHAT_PANEL_EXPAND_EVENT));
  window.dispatchEvent(
    new CustomEvent(CHAT_DRAFT_EVENT, { detail: { text: prompt, mode: 'replace' } }),
  );
}
