import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  isWeChatAssistantTaskId,
  listWeChatAssistantTasks,
  updateWeChatAssistantTask,
  type WeChatAssistantTaskId,
} from '@/lib/wechat-assistant/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  message: z.string().min(1).max(1000),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_message' }, { status: 400 });
  }

  const message = parsed.data.message.trim();
  const actions: Array<{ type: string; label: string }> = [];
  let reply = '我可以帮你管理微信分析任务。你可以说“每天晚上 9 点总结微信消息”“暂停每日总结”“开启待办提取”。';
  let tasks = listWeChatAssistantTasks();

  const target = inferTask(message);
  const schedule = inferSchedule(message);
  const shouldDisable = /暂停|停用|关闭|取消/.test(message);
  const shouldEnable = /开启|启用|每天|每日|定时|提醒|总结|提取|跟进/.test(message) && !shouldDisable;

  if (/分析|总结|刷新|重新/.test(message) && !target) {
    reply = '我已准备刷新微信智能分析。点击下方“刷新分析”，会重新读取本机微信消息并更新摘要、待办和重要消息。';
    actions.push({ type: 'refresh_analysis', label: '刷新分析' });
  }

  if (target && isWeChatAssistantTaskId(target)) {
    const patch: { enabled?: boolean; schedule?: string } = {};
    if (shouldDisable) patch.enabled = false;
    if (shouldEnable) patch.enabled = true;
    if (schedule) patch.schedule = schedule;
    if (Object.keys(patch).length === 0) patch.enabled = true;
    tasks = updateWeChatAssistantTask(target, patch);
    const task = tasks.find((item) => item.id === target);
    reply = [
      task?.enabled ? `已启用「${task.title}」` : `已暂停「${task?.title ?? '任务'}」`,
      task?.schedule ? `执行时间：${task.schedule}` : '',
      '你可以在“内置任务”页签继续检查和调整。',
    ].filter(Boolean).join('。');
    actions.push({ type: 'open_tasks', label: '查看任务' });
  }

  return NextResponse.json({ reply, actions, tasks });
}

function inferTask(message: string): WeChatAssistantTaskId | null {
  if (/每日|每天|日报|日总结|总结/.test(message)) return 'daily-summary';
  if (/重要|紧急|提醒|关键词|风险/.test(message)) return 'important-alert';
  if (/待办|todo|事项|任务|提取/.test(message.toLowerCase())) return 'todo-extract';
  if (/跟进|客户|联系人|未回复/.test(message)) return 'follow-up';
  return null;
}

function inferSchedule(message: string): string | null {
  if (/实时|马上|立即/.test(message)) return '实时';
  const colon = /(\d{1,2})\s*[:：]\s*(\d{1,2})/.exec(message);
  if (colon) return formatTime(adjustMeridiem(Number(colon[1]), message), Number(colon[2]));
  const hourOnly = /(\d{1,2})\s*(点|时)/.exec(message);
  if (hourOnly) return formatTime(adjustMeridiem(Number(hourOnly[1]), message), 0);
  return null;
}

function adjustMeridiem(hour: number, message: string): number {
  if (/(下午|晚上|傍晚|今晚|夜里)/.test(message) && hour >= 1 && hour <= 11) {
    return hour + 12;
  }
  if (/(中午)/.test(message) && hour >= 1 && hour <= 10) {
    return hour + 12;
  }
  return hour;
}

function formatTime(hour: number, minute: number): string {
  return `${String(Math.min(23, Math.max(0, hour))).padStart(2, '0')}:${String(
    Math.min(59, Math.max(0, minute)),
  ).padStart(2, '0')}`;
}
