/**
 * 飞书电子表格服务
 */
import { feishuFetch } from './feishu-api.js';
import { getToken } from './auth.js';

/**
 * 单元格值转字符串
 */
function cellToString(cell) {
  if (cell === null || cell === undefined) return '';
  if (Array.isArray(cell)) {
    return cell.map(seg => seg.text || seg.toString()).join('');
  }
  if (typeof cell === 'object') return JSON.stringify(cell);
  return String(cell);
}

/**
 * 二维数组转 Markdown 表格
 */
function valuesToMarkdown(sheetName, values) {
  if (!values || values.length === 0) return '';
  const lines = [`## ${sheetName}`, ''];
  const header = values[0].map(c =>
    cellToString(c).replace(/\|/g, '\\|').replace(/\n/g, ' ') || ' '
  );
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`|${header.map(() => '---').join('|')}|`);

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const cells = [];
    for (let j = 0; j < header.length; j++) {
      cells.push(cellToString(row[j]).replace(/\|/g, '\\|').replace(/\n/g, ' ') || ' ');
    }
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

/**
 * 获取工作表列表
 */
async function getSheetList(sheetToken) {
  const data = await feishuFetch(
    `/sheets/v3/spreadsheets/${sheetToken}/sheets/query`
  );
  return data.sheets || [];
}

/**
 * 获取单个工作表数据
 */
async function getSheetValues(sheetToken, sheetId) {
  const data = await feishuFetch(
    `/sheets/v2/spreadsheets/${sheetToken}/values/${sheetId}`
  );
  return data.valueRange?.values || [];
}

/**
 * 读取电子表格内容
 * @param {string} sheetToken - 表格 token
 * @param {string} format - 输出格式: markdown | json
 */
export async function readSpreadsheet(sheetToken, format = 'markdown') {
  const meta = await feishuFetch(`/sheets/v3/spreadsheets/${sheetToken}`);
  const title = meta.spreadsheet?.title || '未命名表格';
  const sheets = await getSheetList(sheetToken);

  if (format === 'json') {
    const result = [];
    for (const sheet of sheets) {
      const rawValues = await getSheetValues(sheetToken, sheet.sheet_id);
      const values = (rawValues || []).map(row =>
        (row || []).map(cell => cellToString(cell))
      );
      result.push({ id: sheet.sheet_id, name: sheet.title || sheet.sheet_id, values });
    }
    return { title, sheetToken, sheets: result };
  }

  // markdown 格式
  const parts = [`# ${title}`, ''];
  for (const sheet of sheets) {
    const values = await getSheetValues(sheetToken, sheet.sheet_id);
    const md = valuesToMarkdown(sheet.title || sheet.sheet_id, values);
    if (md) parts.push(md, '');
  }
  return { title, content: parts.join('\n').trim(), sheetToken };
}

/**
 * 追加行到工作表末尾
 */
export async function appendRows(sheetToken, sheetId, rows) {
  const data = await feishuFetch(
    `/sheets/v2/spreadsheets/${sheetToken}/values_append`,
    {
      method: 'POST',
      body: JSON.stringify({
        valueRange: { range: sheetId, values: rows }
      })
    }
  );
  return { success: true, data };
}

/**
 * 更新指定范围的单元格
 */
export async function updateCells(sheetToken, sheetId, range, values) {
  const fullRange = `${sheetId}!${range}`;
  const data = await feishuFetch(
    `/sheets/v2/spreadsheets/${sheetToken}/values`,
    {
      method: 'PUT',
      body: JSON.stringify({
        valueRange: { range: fullRange, values }
      })
    }
  );
  return { success: true, data };
}
