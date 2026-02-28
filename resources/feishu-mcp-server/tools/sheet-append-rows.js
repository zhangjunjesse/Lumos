/**
 * 工具: feishu_sheet_append_rows - 追加行到表格
 */
import { parseFeishuUrl, success, error } from '../utils/helpers.js';
import { appendRows } from '../services/spreadsheet.js';

export const name = 'feishu_sheet_append_rows';

export const description = '向飞书电子表格追加行。需指定工作表 ID（通过 feishu_sheet_read 的 json 格式获取）。';

export const inputSchema = {
  type: 'object',
  properties: {
    url: {
      type: 'string',
      description: '飞书电子表格 URL'
    },
    sheet_id: {
      type: 'string',
      description: '工作表 ID，通过 feishu_sheet_read (format=json) 获取'
    },
    rows: {
      type: 'array',
      items: { type: 'array', items: {} },
      description: '要追加的行数据，二维数组'
    }
  },
  required: ['url', 'sheet_id', 'rows']
};

export async function handler({ url, sheet_id, rows }) {
  try {
    const parsed = parseFeishuUrl(url);
    if (!parsed || parsed.type !== 'sheets') {
      return error('无效的飞书电子表格 URL');
    }
    const result = await appendRows(parsed.docId, sheet_id, rows);
    return success(result);
  } catch (err) {
    return error(err.message);
  }
}
