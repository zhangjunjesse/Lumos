/**
 * 工具: feishu_sheet_read - 读取电子表格
 */
import { parseFeishuUrl, success, error } from '../utils/helpers.js';
import { readSpreadsheet } from '../services/spreadsheet.js';

export const name = 'feishu_sheet_read';

export const description = '读取飞书电子表格内容。支持 markdown（表格渲染）和 json（结构化数据，含 sheetId 供后续编辑）两种格式。';

export const inputSchema = {
  type: 'object',
  properties: {
    url: {
      type: 'string',
      description: '飞书电子表格 URL，格式：feishu.cn/sheets/xxx'
    },
    format: {
      type: 'string',
      enum: ['markdown', 'json'],
      default: 'markdown',
      description: '输出格式'
    }
  },
  required: ['url']
};

export async function handler({ url, format }) {
  try {
    const parsed = parseFeishuUrl(url);
    if (!parsed || parsed.type !== 'sheets') {
      return error('无效的飞书电子表格 URL');
    }
    const result = await readSpreadsheet(parsed.docId, format || 'markdown');
    return success(result);
  } catch (err) {
    return error(err.message);
  }
}
