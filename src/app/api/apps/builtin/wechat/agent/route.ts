import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  createWeChatAutomation,
  deleteWeChatAutomation,
  listWeChatAutomations,
  triggerWeChatAutomation,
  updateWeChatAutomation,
} from '@/lib/wechat-assistant/automations';
import {
  addManualTodo,
  listTodos,
  setTodoStatus,
} from '@/lib/wechat-assistant/db';
import { searchMessages, type MessageSearchResult } from '@/lib/wechat-assistant/mirror-store';
import { displayWechatName, safeSanitizedWechatText } from '@/lib/wechat-assistant/wechat-text';
import type { Automation } from '@/components/apps/builtin/wechat/relations-types';
import type { TodoStatus, WeChatTodo } from '@/lib/wechat-assistant/ai-types';

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
  const actions: Array<{ type: string; label: string; query?: string; followupId?: string }> = [];
  let reply = '我可以帮你创建和管理微信提醒。你可以说“每天晚上 9 点总结微信消息”“把国信提醒改成每天 10 点”“国信提醒为什么失败”。';
  let automations = listWeChatAutomations();

  const shouldDelete = /删除|移除|删掉/.test(message);
  const shouldDisable = /暂停|停用|关闭|取消/.test(message);
  const shouldEnable = /开启|启用|恢复|打开/.test(message);
  const shouldUpdate = /修改|调整|改成|改为|改到|设为|换成|更新/.test(message);
  const shouldInspect = /状态|失败|报错|错误|原因|诊断|为什么|最近结果|运行结果/.test(message);
  const shouldRunNow = /立即|马上|现在|立刻|执行|运行|跑一下/.test(message)
    && /总结|报告|提醒|自动化|任务/.test(message);
  const shouldListFollowups = isFollowupTaskMessage(message) && /有哪些|列表|看看|查看|状态|打开/.test(message);
  const shouldCreateFollowup = isFollowupTaskMessage(message) && /新增|新建|创建|添加|加一条|记一条|记录|记下|记一下/.test(message);
  const shouldCompleteFollowup = isFollowupTaskMessage(message) && /完成|已处理|处理完|办完|标记/.test(message);
  const messageSearchQuery = inferMessageSearchQuery(message);

  if (shouldListFollowups) {
    const todos = listActiveFollowupTodos();
    actions.push({ type: 'open_followups', label: '去跟进页' });
    return NextResponse.json({
      reply: followupListReply(todos),
      actions,
      automations,
    });
  }

  if (shouldCompleteFollowup) {
    const todos = listActiveFollowupTodos();
    const target = findTargetFollowup(message, todos, { allowSingleFallback: todos.length === 1 });
    if (!target) {
      actions.push({ type: 'open_followups', label: '去跟进页' });
      return NextResponse.json({
        reply: todos.length > 0
          ? '没找到要完成的跟进任务。请带上任务标题，比如“完成整理合同回款”。'
          : '当前没有待处理的跟进任务。',
        actions,
        automations,
      });
    }
    const done = setTodoStatus(target.id, 'done');
    actions.push({ type: 'open_followups', label: '去跟进页', followupId: done?.id ?? target.id });
    return NextResponse.json({
      reply: `已把跟进任务「${done?.text ?? target.text}」标记为已完成。`,
      actions,
      automations,
    });
  }

  if (shouldCreateFollowup) {
    const draft = inferFollowupDraft(message);
    if (!draft.text) {
      actions.push({ type: 'open_followups', label: '去跟进页' });
      return NextResponse.json({
        reply: '我还没识别到跟进任务内容。可以这样说：“新增跟进：整理客户问题清单”。',
        actions,
        automations,
      });
    }
    const todo = addManualTodo({
      text: draft.text,
      sourceWxid: null,
      sourceDisplay: null,
      involvedWxids: [],
      summary: '通过微信助手创建',
      nextStep: draft.byWhenText ?? null,
      followupType: 'other',
      byWhenText: draft.byWhenText,
      dueAt: draft.dueAt,
      remindAt: null,
    });
    actions.push({ type: 'open_followups', label: '去跟进页', followupId: todo.id });
    return NextResponse.json({
      reply: `已新增跟进任务「${todo.text}」。可以到跟进页继续补充联系人、提醒时间和下一步。`,
      actions,
      automations,
    });
  }

  if (shouldInspect) {
    const target = findTargetAutomation(message, automations, { allowSingleFallback: false });
    if (target) {
      return NextResponse.json({ reply: automationDiagnosticReply(target), actions, automations });
    }
  }

  if (/有哪些|列表|状态|看看|查看/.test(message) && /自动化|提醒|任务|总结/.test(message)) {
    reply = automations.length > 0
      ? `当前有 ${automations.length} 条微信自动化：${automations.map((item) => `${item.enabled ? '启用' : '暂停'}「${item.name}」${item.lastRunStatus ? `（最近${runStatusText(item.lastRunStatus)}）` : ''}`).join('；')}`
      : '当前还没有微信自动化。你可以说“每天晚上 9 点总结微信消息”来创建。';
    return NextResponse.json({ reply, actions, automations });
  }

  if (messageSearchQuery) {
    const results = searchMessages({
      query: messageSearchQuery,
      scope: 'all',
      sinceTs: null,
      limit: 5,
    });
    actions.push({ type: 'open_overview', label: '去概况页搜索', query: messageSearchQuery });
    return NextResponse.json({
      reply: messageSearchReply(messageSearchQuery, results),
      actions,
      automations,
    });
  }

  if (shouldInspect) {
    const target = findTargetAutomation(message, automations, { allowSingleFallback: true });
    if (!target) {
      return NextResponse.json({
        reply: '没找到要诊断的微信自动化。请带上自动化名称，比如“国信项目提醒为什么失败”。',
        actions,
        automations,
      });
    }
    return NextResponse.json({ reply: automationDiagnosticReply(target), actions, automations });
  }

  if (shouldDelete) {
    const target = findTargetAutomation(message, automations, { allowSingleFallback: true });
    if (!target) {
      return NextResponse.json({
        reply: '没找到要删除的微信自动化。请带上自动化名称，比如“删除每日微信总结”。',
        actions,
        automations,
      });
    }
    try {
      await deleteWeChatAutomation(target.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除失败';
      return NextResponse.json({
        reply: `暂时不能删除「${target.name}」：${message}`,
        actions,
        automations,
      }, { status: 409 });
    }
    automations = listWeChatAutomations();
    reply = `已删除「${target.name}」，并已同步删除背后的调度任务。`;
    actions.push({ type: 'refresh_automations', label: '刷新自动化' });
    return NextResponse.json({ reply, actions, automations });
  }

  if (shouldDisable) {
    const target = findTargetAutomation(message, automations, { allowSingleFallback: true });
    if (!target) {
      return NextResponse.json({
        reply: '没找到要暂停的微信自动化。你可以说“暂停每日总结”，或到自动化列表里直接关掉开关。',
        actions,
        automations,
      });
    }
    const updated = await updateWeChatAutomation(target.id, { enabled: false });
    automations = listWeChatAutomations();
    reply = `已暂停「${updated?.name ?? target.name}」。`;
    actions.push({ type: 'refresh_automations', label: '刷新自动化' });
    return NextResponse.json({ reply, actions, automations });
  }

  if (shouldEnable) {
    const target = findTargetAutomation(message, automations, { allowSingleFallback: true });
    if (!target) {
      return NextResponse.json({
        reply: '没找到要开启的微信自动化。你可以说“开启每日总结”，或先创建一条自动化。',
        actions,
        automations,
      });
    }
    const updated = await updateWeChatAutomation(target.id, { enabled: true });
    automations = listWeChatAutomations();
    reply = `已开启「${updated?.name ?? target.name}」。`;
    actions.push({ type: 'refresh_automations', label: '刷新自动化' });
    return NextResponse.json({ reply, actions, automations });
  }

  if (shouldUpdate) {
    const target = findTargetAutomation(message, automations, { allowSingleFallback: true });
    if (!target) {
      return NextResponse.json({
        reply: '没找到要修改的微信自动化。请带上自动化名称，比如“把国信项目提醒改成每天 10 点”。',
        actions,
        automations,
      });
    }
    const patch = inferAutomationPatch(message, target);
    if (!patch) {
      return NextResponse.json({
        reply: `我找到了「${target.name}」，但还没识别到要修改的时间或内容。你可以说“把${target.name}改成每天 10 点”。`,
        actions,
        automations,
      });
    }
    const updated = await updateWeChatAutomation(target.id, patch);
    automations = listWeChatAutomations();
    reply = [
      `已更新「${updated?.name ?? target.name}」`,
      updated?.scheduleError ? updated.scheduleError : updated?.scheduleId ? '已同步调度' : '',
      updated?.cronLabel ? `时间：${updated.cronLabel}` : '',
    ].filter(Boolean).join('。');
    actions.push({ type: 'refresh_automations', label: '刷新自动化' });
    return NextResponse.json({ reply, actions, automations });
  }


  if (shouldRunNow) {
    let target = findTargetAutomation(message, automations, { allowSingleFallback: true });
    if (!target && /总结|报告/.test(message)) {
      const instantDraft: Omit<Automation, 'id' | 'createdAt'> = {
        name: '即时微信总结',
        kind: 'reminder_once',
        cron: cronFromTime(currentTime()),
        cronLabel: '立即运行',
        action: { kind: 'wechat_summary', messageTemplate: '立即汇总微信消息，提炼重点、待办和需要跟进的人。' },
        enabled: false,
        nextRunAt: Date.now() + 60_000,
      };
      const existingInstant = automations.find((item) => item.name === '即时微信总结') ?? null;
      target = existingInstant
        ? await updateWeChatAutomation(existingInstant.id, instantDraft)
        : await createWeChatAutomation(instantDraft);
    }
    if (!target) {
      return NextResponse.json({
        reply: '没找到可立即运行的微信自动化。你可以先说“每天晚上 9 点总结微信消息”创建任务，或在自动化列表里新建提醒。',
        actions,
        automations,
      });
    }
    const triggered = await triggerWeChatAutomation(target.id);
    automations = listWeChatAutomations();
    reply = `已触发「${triggered?.name ?? target.name}」。运行状态会显示在自动化卡片和“最近结果”里。`;
    actions.push({ type: 'refresh_automations', label: '刷新自动化' });
    return NextResponse.json({ reply, actions, automations });
  }

  const intent = inferAutomationIntent(message);
  if (intent) {
    const existing = intent.kind === 'daily_summary'
      ? automations.find((item) => item.name === '每日微信总结') ?? null
      : null;
    const automation = existing
      ? await updateWeChatAutomation(existing.id, { ...intent.automation, enabled: true })
      : await createWeChatAutomation(intent.automation);
    if (!automation) {
      return NextResponse.json({ error: 'automation_not_found' }, { status: 404 });
    }
    automations = listWeChatAutomations();
    reply = [
      existing ? `已更新「${automation.name}」` : `已创建「${automation.name}」`,
      automation?.scheduleError ? automation.scheduleError : automation?.scheduleId ? '已接入自动调度' : '',
      `时间：${automation.cronLabel}`,
    ].filter(Boolean).join('。');
    actions.push({ type: 'refresh_automations', label: '刷新自动化' });
    return NextResponse.json({ reply, actions, automations });
  }

  if (/分析|刷新|重新/.test(message)) {
    reply = '你可以在「跟进」页点击“分析微信消息”，我会从微信消息里提取待办和跟进候选。';
    actions.push({ type: 'open_followups', label: '去跟进页' });
  }

  return NextResponse.json({ reply, actions, automations });
}

type AutomationIntent =
  | {
      kind: 'daily_summary';
      automation: Omit<Automation, 'id' | 'createdAt'>;
    }
  | {
      kind: 'reminder';
      automation: Omit<Automation, 'id' | 'createdAt'>;
    };

function inferAutomationIntent(message: string): AutomationIntent | null {
  const time = inferSchedule(message) ?? '09:00';
  const cron = inferCron(message, time);
  if (/每日|每天|日报|日总结|总结/.test(message)) {
    return {
      kind: 'daily_summary',
      automation: {
        name: '每日微信总结',
        kind: 'reminder_recurring',
        cron,
        cronLabel: cronLabel(message, time),
        action: { kind: 'wechat_summary', messageTemplate: '汇总今天微信消息，提炼重点、待办和需要跟进的人。' },
        enabled: true,
      },
    };
  }

  if (/提醒|跟进|催|问|联系/.test(message)) {
    const nextRunAt = inferOneTimeTs(message, time);
    const recurring = /每天|每日|每周|每隔|每\d+\s*小时/.test(message);
    return {
      kind: 'reminder',
      automation: {
        name: cleanupName(message),
        kind: recurring ? 'reminder_recurring' : 'reminder_once',
        cron: recurring ? cron : cronFromTime(time),
        cronLabel: recurring ? cronLabel(message, time) : `${relativeDateLabel(message)} ${time}`,
        action: { kind: 'custom', messageTemplate: message },
        enabled: true,
        nextRunAt: recurring ? undefined : nextRunAt,
      },
    };
  }

  return null;
}

function inferAutomationPatch(
  message: string,
  target: Automation,
): Partial<Omit<Automation, 'id' | 'createdAt'>> | null {
  const scheduleText = message.replace(target.name, '');
  const time = inferSchedule(scheduleText) ?? inferTimeFromCron(target.cron) ?? '09:00';
  const hasScheduleChange = /(\d{1,2})\s*[:：]?\s*(\d{1,2})?\s*(点|时)?|每天|每日|每周|每隔|明天|后天|今天|今晚|明早|明晚/.test(scheduleText);
  const template = inferMessageTemplate(message, target);
  const patch: Partial<Omit<Automation, 'id' | 'createdAt'>> = {};

  if (hasScheduleChange) {
    const recurring = /每天|每日|每周|每隔|每\d+\s*小时/.test(scheduleText)
      || (!/明天|后天|今天|今晚|明早|明晚/.test(scheduleText) && target.kind === 'reminder_recurring');
    patch.kind = recurring ? 'reminder_recurring' : 'reminder_once';
    patch.cron = recurring ? inferCron(scheduleText, time) : cronFromTime(time);
    patch.cronLabel = recurring ? cronLabel(scheduleText, time) : `${relativeDateLabel(scheduleText)} ${time}`;
    patch.nextRunAt = recurring ? undefined : inferOneTimeTs(scheduleText, time);
  }

  if (template) {
    patch.action = { ...target.action, messageTemplate: template } as Automation['action'];
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function inferMessageTemplate(message: string, target: Automation): string | null {
  const explicit = /(?:提醒内容|提醒文案|通知内容|通知文案|总结要求|报告要求|总结提示词|提示词|内容|文案|要求)(?:改成|改为|设为|换成|更新为|调整为|是|[:：])?\s*(.{2,300})$/.exec(message);
  const reminder = /(?:提醒我|通知我)\s*(.{2,300})$/.exec(message);
  const match = explicit ?? reminder;
  if (!match) return null;
  const raw = match[1]?.trim() ?? '';
  const cleaned = raw
    .replace(target.name, '')
    .replace(/^(?:的)?(?:改成|改为|设为|换成|更新为|调整为|是)?/, '')
    .replace(/^[：:，,\s"'“”‘’「」『』《》【】]+/, '')
    .replace(/["'“”‘’「」『』《》【】]+$/, '')
    .trim();
  return cleaned || null;
}

function inferSchedule(message: string): string | null {
  const colon = /(\d{1,2})\s*[:：]\s*(\d{1,2})/.exec(message);
  if (colon) return formatTime(adjustMeridiem(Number(colon[1]), message), Number(colon[2]));
  const hourOnly = /(\d{1,2})\s*(点|时)/.exec(message);
  if (hourOnly) return formatTime(adjustMeridiem(Number(hourOnly[1]), message), 0);
  return null;
}

function inferCron(message: string, time: string): string {
  const [hour, minute] = time.split(':').map(Number);
  const hourStep = /每(?:隔)?\s*(\d{1,2})\s*小时/.exec(message);
  if (hourStep) return `${minute || 0} */${Math.max(1, Number(hourStep[1]))} * * *`;
  const weekly = /每周([日天一二三四五六0-6])/.exec(message);
  if (weekly) return `${minute || 0} ${hour || 9} * * ${weekdayNumber(weekly[1])}`;
  return `${minute || 0} ${hour || 9} * * *`;
}

function cronFromTime(time: string): string {
  const [hour, minute] = time.split(':').map(Number);
  return `${minute || 0} ${hour || 9} * * *`;
}

function inferTimeFromCron(cron: string): string | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour] = parts;
  if (!/^\d{1,2}$/.test(minute) || !/^\d{1,2}$/.test(hour)) return null;
  return formatTime(Number(hour), Number(minute));
}

function currentTime(): string {
  const d = new Date();
  return formatTime(d.getHours(), d.getMinutes());
}

function cronLabel(message: string, time: string): string {
  const hourStep = /每(?:隔)?\s*(\d{1,2})\s*小时/.exec(message);
  if (hourStep) return `每 ${Number(hourStep[1])} 小时`;
  const weekly = /每周([日天一二三四五六0-6])/.exec(message);
  if (weekly) return `每周${weekly[1]} ${time}`;
  return `每天 ${time}`;
}

function inferOneTimeTs(message: string, time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  const d = new Date();
  if (/后天/.test(message)) d.setDate(d.getDate() + 2);
  else if (/明天|明早|明晚/.test(message)) d.setDate(d.getDate() + 1);
  d.setHours(hour || 9, minute || 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function relativeDateLabel(message: string): string {
  if (/后天/.test(message)) return '后天';
  if (/明天|明早|明晚/.test(message)) return '明天';
  if (/今天|今晚/.test(message)) return '今天';
  return '明天';
}

function cleanupName(message: string): string {
  const cleaned = message
    .replace(/^(帮我|请|请你|麻烦你)?/, '')
    .replace(/提醒我|提醒|创建|新建|帮我/g, '')
    .trim();
  return (cleaned || '微信提醒').slice(0, 30);
}

function findTargetAutomation(
  message: string,
  automations: Automation[],
  options: { allowSingleFallback?: boolean } = {},
): Automation | null {
  const normalizedMessage = normalizeTargetText(message);
  const exact = automations.find((item) => normalizedMessage.includes(normalizeTargetText(item.name))) ?? null;
  if (exact) return exact;
  if (/每日微信总结|每日总结|微信总结|微信日报|微信报告|日总结|总结|报告/.test(message)) {
    return automations.find((item) => item.name === '每日微信总结') ?? null;
  }
  if (options.allowSingleFallback && automations.length === 1) {
    return automations[0] ?? null;
  }
  return null;
}

function normalizeTargetText(value: string): string {
  return value.replace(/[\s"'“”‘’「」『』《》【】（）()]/g, '').toLowerCase();
}

function automationDiagnosticReply(automation: Automation): string {
  const lines = [
    `「${automation.name}」当前${automation.enabled ? '启用' : '暂停'}，时间是 ${automation.cronLabel}。`,
  ];
  if (automation.scheduleError) {
    lines.push(`调度状态：未正常接入。原因：${automation.scheduleError}`);
  } else if (automation.scheduleId) {
    lines.push('调度状态：已接入调度。');
  } else {
    lines.push('调度状态：仅保存规则，暂未接入调度。');
  }
  if (automation.lastRunStatus) {
    lines.push(`最近运行：${runStatusText(automation.lastRunStatus)}${automation.lastRunAt ? `，时间 ${formatShortTime(automation.lastRunAt)}` : ''}。`);
  } else {
    lines.push('最近运行：尚未触发。');
  }
  if (automation.lastRunError) {
    lines.push(`错误原因：${automation.lastRunError}`);
  }
  if (automation.latestRunId && automation.scheduleId) {
    lines.push('可以在这条自动化卡片里点“最新结果”或“记录”查看完整执行详情。');
  }
  return lines.join('\n');
}

function isFollowupTaskMessage(message: string): boolean {
  return /(跟进|待办|事项|todo|TODO)/i.test(message)
    || (/(任务)/.test(message) && !/(自动化|总结|报告|提醒)/.test(message));
}

function listActiveFollowupTodos(): WeChatTodo[] {
  return listTodos({ status: ['open', 'in_progress', 'suggested'] as TodoStatus[] });
}

function followupListReply(todos: WeChatTodo[]): string {
  if (todos.length === 0) {
    return '当前没有待处理的跟进任务。你可以说“新增跟进：整理客户问题清单”。';
  }
  const lines = [
    `当前有 ${todos.length} 条待处理跟进：`,
    ...todos.slice(0, 8).map((todo, index) => {
      const status = todo.status === 'in_progress'
        ? '进行中'
        : todo.status === 'suggested'
          ? 'AI 推荐'
          : '待处理';
      const due = todo.dueAt ? `，${formatShortTime(todo.dueAt)} 到期` : '';
      return `${index + 1}. ${status}「${shortText(todo.text, 40)}」${due}`;
    }),
  ];
  if (todos.length > 8) lines.push(`还有 ${todos.length - 8} 条，可以到跟进页查看。`);
  return lines.join('\n');
}

function findTargetFollowup(
  message: string,
  todos: WeChatTodo[],
  options: { allowSingleFallback?: boolean } = {},
): WeChatTodo | null {
  const normalizedMessage = normalizeTargetText(message);
  const exact = todos.find((todo) => normalizedMessage.includes(normalizeTargetText(todo.text))) ?? null;
  if (exact) return exact;
  const fuzzy = todos.find((todo) => {
    const key = normalizeTargetText(todo.text).slice(0, 12);
    return key.length >= 4 && normalizedMessage.includes(key);
  }) ?? null;
  if (fuzzy) return fuzzy;
  if (options.allowSingleFallback && todos.length === 1) return todos[0] ?? null;
  return null;
}

function inferFollowupDraft(message: string): { text: string; byWhenText: string | null; dueAt: number | null } {
  const raw = message
    .replace(/^(帮我|请|请你|麻烦你)?/, '')
    .replace(/^(新增|新建|创建|添加|加一条|记一条|记录|记下|记一下)\s*/, '')
    .replace(/^(一个|一条)?\s*(微信)?\s*(跟进任务|跟进|待办事项|待办|事项|任务|todo|TODO)\s*/, '')
    .replace(/^[：:，,\s]+/, '')
    .trim();
  const text = safeSanitizedWechatText(raw, '').slice(0, 200);
  if (!text) return { text: '', byWhenText: null, dueAt: null };
  const byWhenText = inferByWhenText(message);
  const time = inferSchedule(message) ?? '09:00';
  const dueAt = byWhenText ? inferOneTimeTs(message, time) : null;
  return { text, byWhenText, dueAt };
}

function inferByWhenText(message: string): string | null {
  if (/后天/.test(message)) return '后天';
  if (/明天|明早|明晚/.test(message)) return '明天';
  if (/今天|今晚/.test(message)) return '今天';
  return null;
}

function inferMessageSearchQuery(message: string): string | null {
  if (!/(搜索|查找|查一下|找一下|找找|找|看看|有没有|提到|关于)/.test(message)) return null;
  if (!/(微信|聊天|消息|记录)/.test(message)) return null;
  if (/(自动化|提醒|任务|总结).*(列表|状态|失败|运行结果|最近结果)/.test(message)) return null;

  const quoted = /[「『“"']([^」』”"']{1,80})[」』”"']/.exec(message);
  if (quoted?.[1]) return cleanupSearchQuery(quoted[1]);

  const about = /(?:关于|包含|提到)\s*([^，。！？,.!?]{1,80})/.exec(message);
  if (about?.[1]) return cleanupSearchQuery(about[1]);

  const existence = /(?:有没有|是否有)\s*([^，。！？,.!?]{1,80})/.exec(message);
  if (existence?.[1]) return cleanupSearchQuery(existence[1]);

  const afterVerb = /(?:搜索|查找|查一下|找一下|找找|找|看看)(.+)$/.exec(message);
  if (afterVerb?.[1]) return cleanupSearchQuery(afterVerb[1]);

  return null;
}

function cleanupSearchQuery(value: string): string | null {
  const query = value
    .replace(/^(?:一下|下|微信|聊天记录|聊天|消息|记录|里|里面|中|关于|包含|提到|有没有|是否有|帮我|请你|请|麻烦你)+/, '')
    .replace(/(?:相关)?(?:的)?(?:微信消息|聊天记录|聊天|消息|记录|内容)?$/, '')
    .replace(/^[：:，,\s]+|[：:，,。.!！?\s]+$/g, '')
    .trim();
  if (query.length < 1) return null;
  return query.slice(0, 80);
}

function messageSearchReply(query: string, results: MessageSearchResult[]): string {
  if (results.length === 0) {
    return `没有找到和「${query}」相关的微信消息。可以到概况页的“聊天记录搜索”里扩大时间范围或换个关键词。`;
  }
  const lines = [
    `找到 ${results.length} 条和「${query}」相关的微信消息：`,
    ...results.map((item, index) => {
      const chatType = item.isGroup ? '群聊' : '私聊';
      const sender = item.sender === 'me'
        ? '我'
        : item.isGroup
          ? displayWechatName(item.senderDisplay, null, { contactFallback: '群成员' })
          : '对方';
      const chatName = displayWechatName(item.display, item.wxid, {
        groupFallback: '微信群聊',
        contactFallback: '微信联系人',
      });
      return `${index + 1}. ${chatType}「${chatName}」${sender} ${formatShortTime(item.ts * 1000)}：${shortText(item.content, 90)}`;
    }),
    '更多结果和上下文可以到概况页的“聊天记录搜索”查看。',
  ];
  return lines.join('\n');
}

function shortText(value: string, max: number): string {
  const text = safeSanitizedWechatText(value, '消息内容已隐藏').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}...`;
}

function formatShortTime(ts: number): string {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return String(ts);
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function runStatusText(status: Automation['lastRunStatus']): string {
  if (status === 'running') return '运行中';
  if (status === 'success') return '成功';
  if (status === 'error') return '失败';
  if (status === 'cancelled') return '已取消';
  return '未运行';
}

function weekdayNumber(raw: string): number {
  const map: Record<string, number> = {
    日: 0,
    天: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
  };
  if (/^[0-6]$/.test(raw)) return Number(raw);
  return map[raw] ?? 1;
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
