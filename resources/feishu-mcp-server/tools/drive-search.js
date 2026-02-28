/**
 * 工具: feishu_search - 搜索飞书文档
 */
import { success, error } from '../utils/helpers.js';
import { searchFiles } from '../services/drive.js';

export const name = 'feishu_search';

export const description = '搜索飞书中的文档、表格、Wiki。支持全局搜索。';

export const inputSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: '搜索关键词'
    },
    scope: {
      type: 'string',
      enum: ['all', 'mine'],
      default: 'all',
      description: '搜索范围'
    },
    page_token: {
      type: 'string',
      description: '分页偏移量（可选）'
    }
  },
  required: ['query']
};

export async function handler({ query, scope, page_token }) {
  try {
    const result = await searchFiles(query, scope, page_token);
    return success(result);
  } catch (err) {
    return error(err.message);
  }
}
