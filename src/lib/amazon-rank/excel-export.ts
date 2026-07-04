import { writeExcel } from '@/lib/office/excel-writer';

import { KEYWORD_STATUS_LABELS, TOP_N } from './constants';
import { exportFilePath } from './paths';
import type { RankResultRow, RankRunRow } from './types';

/**
 * 导出一次运行的结果 Excel（写到运行输出目录，返回文件路径）。
 * 三个工作表：
 * - 排名矩阵：行=关键词、列=每个监控 ASIN、格=第几名（小白直读）
 * - 排名位次：行=关键词、列=第 1..N 名，命中的位置填 ASIN（兼容原工作流的产出习惯）
 * - 明细：逐关键词状态、自然结果数、前 N 名完整列表、失败原因
 */
export async function exportRunExcel(run: RankRunRow, results: RankResultRow[]): Promise<string> {
  const asins = (run.asins ?? []).map((a) => a.toUpperCase());

  const matrixRows = results.map((row) => {
    const rankByAsin = new Map((row.matches ?? []).map((m) => [m.asin.toUpperCase(), m.rank]));
    return [
      row.keyword,
      statusLabel(row),
      ...asins.map((asin) => {
        const rank = rankByAsin.get(asin);
        if (rank) return `#${rank}`;
        return row.status === 'ok' ? `前${TOP_N}名外` : '';
      }),
    ];
  });

  const positionRows = results.map((row) => {
    const cells: (string | null)[] = Array.from({ length: TOP_N }, () => null);
    for (const match of row.matches ?? []) {
      if (match.rank >= 1 && match.rank <= TOP_N) cells[match.rank - 1] = match.asin;
    }
    return [row.keyword, ...cells];
  });

  const detailRows = results.map((row) => [
    row.seq,
    row.keyword,
    statusLabel(row),
    row.organic_count ?? 0,
    (row.matches ?? []).map((m) => `${m.asin}=#${m.rank}`).join('，'),
    (row.top_asins ?? []).join(' '),
    row.error_message ?? '',
  ]);

  const filePath = exportFilePath(run.id);
  await writeExcel({
    filePath,
    sheets: [
      {
        name: '排名矩阵',
        headers: ['关键词', '状态', ...asins],
        rows: matrixRows,
        columnWidths: [30, 12, ...asins.map(() => 14)],
      },
      {
        name: '排名位次',
        headers: ['关键词', ...Array.from({ length: TOP_N }, (_, i) => `第${i + 1}名`)],
        rows: positionRows,
        columnWidths: [30, ...Array.from({ length: TOP_N }, () => 13)],
      },
      {
        name: '明细',
        headers: ['序号', '关键词', '状态', '自然结果数', '命中', `前${TOP_N}名 ASIN`, '失败原因'],
        rows: detailRows,
        columnWidths: [6, 30, 12, 10, 30, 60, 40],
      },
    ],
  });
  return filePath;
}

function statusLabel(row: RankResultRow): string {
  return KEYWORD_STATUS_LABELS[row.status] ?? row.status;
}
