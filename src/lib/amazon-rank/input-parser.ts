import ExcelJS from 'exceljs';

import { ASIN_RE, HARD_MAX_KEYWORDS } from './constants';
import type { ParsedItems } from './types';

/**
 * 粘贴文本 / Excel 第一列 → 关键词表或 ASIN 表。
 * 解析结果始终回显给用户确认后才会启动查询，所以这里宽进（多分隔符、
 * 自动识别表头）+ 如实告警（去重了几条、丢了哪些非法项）。
 */

const HEADER_WORDS = new Set([
  'keyword', 'keywords', '关键词', '关键字', '词',
  'asin', 'asins', '商品', '商品asin',
]);

export function parseKeywordsText(text: string): ParsedItems {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const items: string[] = [];
  let duplicates = 0;
  let overlong = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const kw = rawLine.trim();
    if (!kw) continue;
    if (kw.length > 200) {
      overlong++;
      continue;
    }
    const key = kw.toLowerCase();
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    items.push(kw);
  }

  if (items.length > 0 && HEADER_WORDS.has(items[0].toLowerCase())) {
    items.shift();
  }
  if (duplicates > 0) warnings.push(`去掉了 ${duplicates} 个重复关键词`);
  if (overlong > 0) warnings.push(`丢弃了 ${overlong} 行超长内容（超过 200 字符）`);
  if (items.length > HARD_MAX_KEYWORDS) {
    warnings.push(`关键词超过上限，只保留前 ${HARD_MAX_KEYWORDS} 个`);
    items.length = HARD_MAX_KEYWORDS;
  }
  return { items, warnings };
}

export function parseAsinsText(text: string): ParsedItems {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const items: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;

  const tokens = text
    .split(/[\s,;，；]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const asin = token.toUpperCase();
    if (HEADER_WORDS.has(token.toLowerCase())) continue;
    if (!ASIN_RE.test(asin)) {
      invalid.push(token);
      continue;
    }
    if (seen.has(asin)) {
      duplicates++;
      continue;
    }
    seen.add(asin);
    items.push(asin);
  }

  if (duplicates > 0) warnings.push(`去掉了 ${duplicates} 个重复 ASIN`);
  if (invalid.length > 0) {
    const preview = invalid.slice(0, 5).join('、');
    warnings.push(
      `忽略了 ${invalid.length} 个不是 ASIN 的内容（ASIN 是 10 位字母数字）：${preview}${invalid.length > 5 ? ' 等' : ''}`,
    );
  }
  return { items, warnings };
}

/** 读 Excel 第一个工作表的第一列，转成文本后复用文本解析（含表头识别、校验、去重） */
export async function parseExcelBuffer(
  buffer: ArrayBuffer | Buffer,
  kind: 'keywords' | 'asins',
): Promise<ParsedItems> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    return { items: [], warnings: ['文件无法解析，请上传 .xlsx 格式的 Excel'] };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { items: [], warnings: ['Excel 里没有工作表'] };
  }

  const lines: string[] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cell = row.getCell(1);
    const value = cellToString(cell.value);
    if (value) lines.push(value);
  });

  if (lines.length === 0) {
    return { items: [], warnings: ['第一列没有读到内容（关键词/ASIN 需要放在第一列）'] };
  }
  return kind === 'keywords'
    ? parseKeywordsText(lines.join('\n'))
    : parseAsinsText(lines.join('\n'));
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return '';
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? '').join('').trim();
    }
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
    if ('result' in value) return cellToString(value.result as ExcelJS.CellValue);
  }
  return '';
}
