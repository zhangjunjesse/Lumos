/**
 * 飞书汇报服务（真实 report/v1 API）
 */
import { BASE_URL, getTenantAccessToken, requireUserAccessToken, getActiveUserInfo } from './auth.js';

const DEFAULT_RULE_NAME = '周报';
const DEFAULT_DAYS = 30;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function toEpochSeconds(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (Number.isFinite(n)) {
    // accept ms and seconds
    return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  }
  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) return fallback;
  return Math.floor(parsed / 1000);
}

function parseScopeFromError(msg) {
  const match = String(msg || '').match(/\[([^\]]+)\]/);
  return match ? match[1] : '';
}

function formatReportApiError(payload) {
  const code = payload?.code;
  const msg = String(payload?.msg || 'report API 调用失败');
  if (code === 99991672) {
    const requiredScope = parseScopeFromError(msg);
    if (requiredScope) {
      return `缺少飞书应用身份权限: ${requiredScope}。请在飞书开放平台为该应用开通后重试。`;
    }
  }
  return `${msg}${code ? ` (code=${code})` : ''}`;
}

async function reportApiFetch(path, { method = 'GET', query, body } = {}) {
  const token = await getTenantAccessToken();
  const url = new URL(`${BASE_URL}${path}`);

  if (query && typeof query === 'object') {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  let payload = {};
  try {
    payload = await res.json();
  } catch {
    // ignore parse errors
  }

  if (!res.ok || payload?.code !== 0) {
    throw new Error(formatReportApiError(payload));
  }

  return payload?.data || {};
}

function pickArray(data, keys) {
  for (const key of keys) {
    const value = data?.[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normalizeRule(item) {
  return {
    ruleId: item?.rule_id || item?.id || '',
    ruleName: item?.rule_name || item?.name || '',
    description: item?.description || item?.desc || '',
    raw: item,
  };
}

function normalizeTask(item) {
  const taskId = item?.task_id || item?.id || '';
  const ruleId = item?.rule_id || '';
  const ruleName = item?.rule_name || item?.rule || '';
  const title = item?.title || item?.name || item?.subject || '';
  const commitTime = item?.commit_time || item?.submitted_time || item?.create_time || 0;
  return {
    taskId,
    ruleId,
    ruleName,
    title,
    commitTime,
    raw: item,
  };
}

function dedupeTasks(items) {
  const map = new Map();
  for (const item of items) {
    const key = `${item.taskId || ''}#${item.ruleId || ''}#${item.commitTime || ''}`;
    if (!key.trim()) continue;
    if (!map.has(key)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

async function queryRules({ ruleName, pageToken, pageSize }) {
  const data = await reportApiFetch('/report/v1/rules/query', {
    method: 'GET',
    query: {
      rule_name: ruleName,
      ...(pageToken !== undefined ? { page_token: pageToken } : {}),
      ...(pageSize !== undefined ? { page_size: pageSize } : {}),
    },
  });

  const items = pickArray(data, ['items', 'rules', 'rule_list']).map(normalizeRule);
  return {
    items,
    hasMore: Boolean(data?.has_more),
    pageToken: data?.page_token || null,
    raw: data,
  };
}

async function queryTasks({
  commitStartTime,
  commitEndTime,
  pageToken,
  pageSize,
  ruleId,
  extraFilters,
}) {
  const body = {
    commit_start_time: commitStartTime,
    commit_end_time: commitEndTime,
    page_token: pageToken ?? '',
    page_size: pageSize,
    ...(ruleId ? { rule_id: ruleId } : {}),
    ...((extraFilters && typeof extraFilters === 'object') ? extraFilters : {}),
  };

  const data = await reportApiFetch('/report/v1/tasks/query', {
    method: 'POST',
    body,
  });

  const items = pickArray(data, ['items', 'tasks', 'task_list', 'records']).map(normalizeTask);
  return {
    items,
    hasMore: Boolean(data?.has_more),
    pageToken: data?.page_token || null,
    raw: data,
  };
}

export async function listReports({
  rule_name,
  query,
  days,
  commit_start_time,
  commit_end_time,
  page_token,
  page_size,
  include_raw,
  task_filters,
}) {
  // 保留“必须登录用户”前提，确保是以当前登录用户发起的查询场景。
  requireUserAccessToken();
  const activeUser = getActiveUserInfo();

  const now = Math.floor(Date.now() / 1000);
  const safeDays = clamp(days, 1, 180, DEFAULT_DAYS);
  const commitEndTime = toEpochSeconds(commit_end_time, now);
  const commitStartTime = toEpochSeconds(commit_start_time, commitEndTime - safeDays * 86400);
  const pageSize = clamp(page_size, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const ruleName = String(rule_name || query || DEFAULT_RULE_NAME).trim() || DEFAULT_RULE_NAME;

  const rulesResp = await queryRules({
    ruleName,
    pageToken: page_token ?? '',
    pageSize,
  });

  const rules = rulesResp.items;
  const allTasks = [];

  if (rules.length > 0) {
    // 优先按规则查询任务。若 rule_id 参数在租户配置下不兼容，降级为不带 rule_id 查询一次。
    for (const rule of rules.slice(0, 5)) {
      try {
        const taskResp = await queryTasks({
          commitStartTime,
          commitEndTime,
          pageToken: '',
          pageSize,
          ruleId: rule.ruleId,
          extraFilters: task_filters,
        });
        allTasks.push(...taskResp.items);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (/field validation/i.test(msg) || /rule_id/i.test(msg)) {
          const fallbackResp = await queryTasks({
            commitStartTime,
            commitEndTime,
            pageToken: '',
            pageSize,
            extraFilters: task_filters,
          });
          allTasks.push(...fallbackResp.items);
          break;
        }
        throw error;
      }
    }
  } else {
    const taskResp = await queryTasks({
      commitStartTime,
      commitEndTime,
      pageToken: page_token ?? '',
      pageSize,
      extraFilters: task_filters,
    });
    allTasks.push(...taskResp.items);
  }

  const tasks = dedupeTasks(allTasks)
    .sort((a, b) => (Number(b.commitTime) || 0) - (Number(a.commitTime) || 0))
    .slice(0, pageSize * 3);

  return {
    source: 'feishu_report_api',
    ruleName,
    window: {
      commitStartTime,
      commitEndTime,
      days: safeDays,
    },
    currentUser: {
      openId: activeUser?.open_id || '',
      name: activeUser?.name || '',
      email: activeUser?.email || '',
    },
    rules,
    tasks,
    ...(include_raw ? { rawRules: rulesResp.raw } : {}),
  };
}

export async function readReportTask({
  task_id,
  rule_id,
  rule_name,
  days,
  commit_start_time,
  commit_end_time,
  page_size,
  include_raw,
}) {
  requireUserAccessToken();

  const now = Math.floor(Date.now() / 1000);
  const safeDays = clamp(days, 1, 180, DEFAULT_DAYS);
  const commitEndTime = toEpochSeconds(commit_end_time, now);
  const commitStartTime = toEpochSeconds(commit_start_time, commitEndTime - safeDays * 86400);
  const pageSize = clamp(page_size, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);

  const taskResp = await queryTasks({
    commitStartTime,
    commitEndTime,
    pageToken: '',
    pageSize,
    ruleId: rule_id || undefined,
    extraFilters: task_id
      ? { task_id }
      : undefined,
  });

  let tasks = taskResp.items;
  if (task_id) {
    tasks = tasks.filter((item) => item.taskId === task_id);
  }
  if (rule_name) {
    const normalizedRuleName = String(rule_name).trim().toLowerCase();
    tasks = tasks.filter((item) => String(item.ruleName || '').toLowerCase().includes(normalizedRuleName));
  }

  const task = tasks[0] || null;
  if (!task) {
    throw new Error('未找到匹配的汇报任务，请调整时间范围或筛选条件后重试');
  }

  return {
    source: 'feishu_report_api',
    task,
    ...(include_raw ? { rawTasks: taskResp.raw } : {}),
  };
}

