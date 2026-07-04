import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ExcelJS from 'exceljs';

import { exportRunExcel } from '../excel-export';
import type { RankResultRow, RankRunRow } from '../types';

describe('exportRunExcel', () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-rank-export-'));
    prevDataDir = process.env.LUMOS_DATA_DIR;
    process.env.LUMOS_DATA_DIR = tmpDir;
  });

  afterAll(() => {
    if (prevDataDir === undefined) delete process.env.LUMOS_DATA_DIR;
    else process.env.LUMOS_DATA_DIR = prevDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('导出排名矩阵 / 排名位次 / 明细三个工作表', async () => {
    const run = {
      id: 'run-1',
      asins: ['B0AAAAAAA1', 'B0BBBBBBB2'],
      started_at: '2026-07-04T00:00:00.000Z',
    } as unknown as RankRunRow;
    const results = [
      {
        id: 'r1', run_id: 'run-1', seq: 1, keyword: 'yoga mat', status: 'ok',
        top_asins: ['B0XXXXXXX0', 'B0AAAAAAA1'], matches: [{ asin: 'B0AAAAAAA1', rank: 2 }],
        organic_count: 2, updated_at: '',
      },
      {
        id: 'r2', run_id: 'run-1', seq: 2, keyword: 'bottle', status: 'no_results',
        top_asins: [], matches: [], organic_count: 0, error_message: '亚马逊提示没有匹配的商品', updated_at: '',
      },
    ] as unknown as RankResultRow[];

    const filePath = await exportRunExcel(run, results);
    expect(fs.existsSync(filePath)).toBe(true);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['排名矩阵', '排名位次', '明细']);

    const matrix = workbook.getWorksheet('排名矩阵')!;
    expect(matrix.getRow(1).getCell(3).value).toBe('B0AAAAAAA1');
    expect(matrix.getRow(2).getCell(1).value).toBe('yoga mat');
    expect(matrix.getRow(2).getCell(3).value).toBe('#2');
    expect(matrix.getRow(2).getCell(4).value).toBe('前20名外');

    const positions = workbook.getWorksheet('排名位次')!;
    expect(positions.getRow(2).getCell(3).value).toBe('B0AAAAAAA1'); // 第2名列

    const detail = workbook.getWorksheet('明细')!;
    expect(detail.getRow(3).getCell(3).value).toBe('无搜索结果');
    expect(detail.getRow(3).getCell(7).value).toBe('亚马逊提示没有匹配的商品');
  });
});
