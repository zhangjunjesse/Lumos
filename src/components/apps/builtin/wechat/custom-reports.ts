import type { OverviewRow } from '@/lib/wechat-assistant/overview-types';

export type CustomReportTemplate =
  | 'emoji'
  | 'night_chat'
  | 'commitment'
  | 'mention_week'
  | 'fallback';

export interface CustomReport {
  id: string;
  template: CustomReportTemplate;
  title: string;
  prompt: string;
  createdAt: number;
}

/**
 * Lightweight keyword router that picks a real local-statistics template from
 * the user's prompt. It does not call a remote model.
 */
export function routeReportTemplate(prompt: string): CustomReportTemplate {
  const p = prompt.toLowerCase();
  if (/emoji|表情|表情包/.test(p)) return 'emoji';
  if (/夜|凌晨|深夜|熬夜|晚上|半夜/.test(p)) return 'night_chat';
  if (/承诺|说过|许下|我说要|交付|逾期/.test(p)) return 'commitment';
  if (/本周|这周|最近一周|最近\s*7\s*天|近\s*7\s*天|最常.*提到|被提到|讨论|活跃/.test(p)) return 'mention_week';
  return 'fallback';
}

export function defaultTitle(template: CustomReportTemplate): string {
  switch (template) {
    case 'emoji':
      return '常用表情统计';
    case 'night_chat':
      return '深夜聊天统计';
    case 'commitment':
      return '疑似承诺事项';
    case 'mention_week':
      return '近 7 天活跃对话';
    case 'fallback':
      return '自定义报表';
  }
}

export interface FallbackTopPersonRow { name: string; messages: number; }

export function fallbackData(rows: OverviewRow[]): FallbackTopPersonRow[] {
  return [...rows]
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, 6)
    .map((r) => ({ name: r.name, messages: r.messageCount }));
}
