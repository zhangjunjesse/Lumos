import ExcelJS from 'exceljs';

import { parseAsinsText, parseExcelBuffer, parseKeywordsText } from '../input-parser';

describe('parseKeywordsText', () => {
  it('按行解析、去空白、大小写不敏感去重', () => {
    const parsed = parseKeywordsText('yoga mat\n  \nYoga Mat\nwater bottle');
    expect(parsed.items).toEqual(['yoga mat', 'water bottle']);
    expect(parsed.warnings.join('')).toContain('重复');
  });

  it('识别并丢掉表头行', () => {
    expect(parseKeywordsText('关键词\nyoga mat').items).toEqual(['yoga mat']);
    expect(parseKeywordsText('Keyword\nyoga mat').items).toEqual(['yoga mat']);
  });

  it('首行按中文词干前缀 / 英文短语识别表头，并如实告警', () => {
    const zh = parseKeywordsText('关键词词组\ngas torch');
    expect(zh.items).toEqual(['gas torch']);
    expect(zh.warnings.join('')).toContain('表头');
    expect(zh.warnings.join('')).toContain('关键词词组');

    expect(parseKeywordsText('Keyword Phrases\ngas torch').items).toEqual(['gas torch']);
    expect(parseKeywordsText('搜索词列表\ngas torch').items).toEqual(['gas torch']);
  });

  it('英文表头只认固定短语，不误伤真实搜索词', () => {
    const parsed = parseKeywordsText('keyword research planner\ngas torch');
    expect(parsed.items).toEqual(['keyword research planner', 'gas torch']);
  });

  it('剔除任意位置的模板占位词并如实告警', () => {
    const parsed = parseKeywordsText('gas torch\n关键词8\n关键词9\nKeyword 12\nbbq torch');
    expect(parsed.items).toEqual(['gas torch', 'bbq torch']);
    expect(parsed.warnings.join('')).toContain('3 个模板占位词');
    expect(parsed.warnings.join('')).toContain('关键词8');
  });

  it('表头 + 占位词混合的模板粘贴只留真实关键词', () => {
    const parsed = parseKeywordsText('关键词词组\ngas torch\nflame torch\n关键词8\n关键词9');
    expect(parsed.items).toEqual(['gas torch', 'flame torch']);
    expect(parsed.warnings).toHaveLength(2);
  });

  it('丢弃超长行并告警', () => {
    const parsed = parseKeywordsText(`${'x'.repeat(201)}\nok keyword`);
    expect(parsed.items).toEqual(['ok keyword']);
    expect(parsed.warnings.join('')).toContain('超长');
  });

  it('超过硬上限截断', () => {
    const lines = Array.from({ length: 250 }, (_, i) => `kw ${i}`).join('\n');
    const parsed = parseKeywordsText(lines);
    expect(parsed.items).toHaveLength(200);
    expect(parsed.warnings.join('')).toContain('上限');
  });
});

describe('parseAsinsText', () => {
  it('多分隔符解析、统一大写、校验 10 位字母数字', () => {
    const parsed = parseAsinsText('b0abcd1234, B0EFGH5678；not-asin\nB0IJKL9012');
    expect(parsed.items).toEqual(['B0ABCD1234', 'B0EFGH5678', 'B0IJKL9012']);
    expect(parsed.warnings.join('')).toContain('not-asin');
  });

  it('去重并忽略表头词', () => {
    const parsed = parseAsinsText('ASIN\nB0ABCD1234 B0ABCD1234');
    expect(parsed.items).toEqual(['B0ABCD1234']);
    expect(parsed.warnings.join('')).toContain('重复');
  });
});

describe('parseExcelBuffer', () => {
  async function buildXlsx(rows: (string | number)[][]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    for (const row of rows) sheet.addRow(row);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  it('读第一列、复用表头识别与校验', async () => {
    const buffer = await buildXlsx([
      ['关键词', '备注'],
      ['yoga mat', 'x'],
      ['water bottle', 'y'],
    ]);
    const parsed = await parseExcelBuffer(buffer, 'keywords');
    expect(parsed.items).toEqual(['yoga mat', 'water bottle']);
  });

  it('ASIN 表跳过无效值', async () => {
    const buffer = await buildXlsx([['B0ABCD1234'], ['bad'], ['B0EFGH5678']]);
    const parsed = await parseExcelBuffer(buffer, 'asins');
    expect(parsed.items).toEqual(['B0ABCD1234', 'B0EFGH5678']);
    expect(parsed.warnings.join('')).toContain('bad');
  });

  it('非 xlsx 内容给出可读错误', async () => {
    const parsed = await parseExcelBuffer(Buffer.from('not an excel'), 'keywords');
    expect(parsed.items).toEqual([]);
    expect(parsed.warnings.join('')).toContain('无法解析');
  });
});
