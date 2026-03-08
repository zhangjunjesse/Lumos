/**
 * 工具: feishu_report_list - 查询汇报任务列表
 */
import { success, error } from '../utils/helpers.js';
import { listReports } from '../services/report.js';

export const name = 'feishu_report_list';

export const description = '查询飞书“汇报应用”任务列表（report/v1 API）。需要应用身份权限：report:rule:readonly、report:task:readonly。';

export const inputSchema = {
  type: 'object',
  properties: {
    rule_name: {
      type: 'string',
      description: '汇报规则名称（如：周报、日报）。'
    },
    query: {
      type: 'string',
      description: 'rule_name 的别名，兼容旧调用。'
    },
    days: {
      type: 'number',
      minimum: 1,
      maximum: 180,
      default: 30,
      description: '回溯天数（未指定起止时间时生效）。'
    },
    commit_start_time: {
      type: 'number',
      description: '提交开始时间（秒级时间戳，支持毫秒自动转换）。'
    },
    commit_end_time: {
      type: 'number',
      description: '提交结束时间（秒级时间戳，支持毫秒自动转换）。'
    },
    page_token: {
      type: 'string',
      description: '分页 token（默认空字符串）。'
    },
    page_size: {
      type: 'number',
      minimum: 1,
      maximum: 100,
      default: 20,
      description: '每次查询任务数量（1-100）。'
    },
    include_raw: {
      type: 'boolean',
      default: false,
      description: '是否返回原始 rules 响应结构。'
    },
    task_filters: {
      type: 'object',
      description: '透传给 report/v1/tasks/query 的额外过滤字段（高级用法）。'
    }
  }
};

export async function handler(input) {
  try {
    const result = await listReports(input || {});
    return success(result);
  } catch (err) {
    return error(err.message);
  }
}
