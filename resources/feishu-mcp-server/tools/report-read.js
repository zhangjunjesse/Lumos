/**
 * 工具: feishu_report_read - 读取汇报任务详情
 */
import { success, error } from '../utils/helpers.js';
import { readReportTask } from '../services/report.js';

export const name = 'feishu_report_read';

export const description = '读取飞书“汇报应用”任务详情（基于 report/v1/tasks/query 结果过滤）。';

export const inputSchema = {
  type: 'object',
  properties: {
    task_id: {
      type: 'string',
      description: '任务 ID（推荐传）。'
    },
    rule_id: {
      type: 'string',
      description: '规则 ID（可选）。'
    },
    rule_name: {
      type: 'string',
      description: '规则名称过滤（可选，如：周报）。'
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
    page_size: {
      type: 'number',
      minimum: 1,
      maximum: 100,
      default: 20,
      description: '查询任务条数（1-100）。'
    },
    include_raw: {
      type: 'boolean',
      default: false,
      description: '是否返回原始 tasks 响应结构。'
    },
  },
};

export async function handler(input) {
  try {
    const result = await readReportTask(input || {});
    return success(result);
  } catch (err) {
    return error(err.message);
  }
}
