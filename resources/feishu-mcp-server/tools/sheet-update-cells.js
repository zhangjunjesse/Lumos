/**
 * 工具: feishu_sheet_update_cells - 更新表格单元格
 */
import { parseFeishuUrl, success, error } from '../utils/helpers.js';
import { updateCells } from '../services/spreadsheet.js';

export const name = 'feishu_sheet_update_cells';

export const description = '更新飞书电子表格中指定范围的单元格值。需指定工作表 ID 和单元格范围（如 A1:C3）。';

export const inputSchema = {
  type: 'object',
  properties: {
    url: {
      type: 'string',
      description: '飞书电子表格 URL'
    },
    sheet_id: {
      type: 'string',
      description: '工作表 ID'
    },
    range: {
      type: 'string',
      description: '单元格范围，如 "A1"、"A1:C3"、"B5:B10"'
    },
    values: {
      type: 'array',
      items: { type: 'array', items: {} },
      description: '要写入的值，二维数组'
    }
  },
  required: ['url', 'sheet_id', 'range', 'values']
};

export async function handler({ url, sheet_id, range, values }) {
  try {
    const parsed = parseFeishuUrl(url);
    if (!parsed || parsed.type !== 'sheets') {
      return error('无效的飞书电子表格 URL');
    }
    const result = await updateCells(parsed.docId, sheet_id, range, values);
    return success(result);
  } catch (err) {
    return error(err.message);
  }
}
