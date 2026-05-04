import { renderReportMarkdown } from '../report-template';
import type { PlatformKey } from '../types';

const baseReport = {
  weekId: '2026-W18',
  generatedAt: '2026-05-03T01:00:00.000Z',
  platforms: ['fanqie', 'qidian'] as PlatformKey[],
  risingTropes: [],
  decliningTropes: [],
  newCombinations: [],
  crossPlatformSpread: [],
  hookPatternArchive: [],
};

describe('renderReportMarkdown', () => {
  test('空数据时各 section 显示占位文案,不抛错', () => {
    const md = renderReportMarkdown(baseReport);
    expect(md).toContain('# 网文套路周报 2026-W18');
    expect(md).toContain('_本周无明显冒头');
    expect(md).toContain('_本周无明显衰退_');
    expect(md).toContain('_本周无新出现的 tag 组合_');
    expect(md).toContain('_本周无跨平台扩散信号_');
    expect(md).toContain('_无可归档 hook 模式_');
  });

  test('rising 渲染表格', () => {
    const md = renderReportMarkdown({
      ...baseReport,
      risingTropes: [
        { tag: '系统', thisWeek: 8, lastWeek: 3 },
      ],
    });
    expect(md).toContain('| 套路 tag | 本周 | 上周 | Δ |');
    expect(md).toContain('| 系统 | 8 | 3 | +5 |');
  });

  test('newCombinations 渲染条目', () => {
    const md = renderReportMarkdown({
      ...baseReport,
      newCombinations: [{ a: '系统', b: '末世', examples: ['fanqie:1', 'fanqie:2'] }],
    });
    expect(md).toContain('系统 × 末世');
    expect(md).toContain('fanqie:1');
  });

  test('crossPlatformSpread 渲染 from→to', () => {
    const md = renderReportMarkdown({
      ...baseReport,
      crossPlatformSpread: [{ tag: '系统', from: 'fanqie' as PlatformKey, to: ['qidian'] }],
    });
    expect(md).toContain('系统');
    expect(md).toContain('fanqie');
    expect(md).toContain('qidian');
  });

  test('hookPatternArchive 渲染条目', () => {
    const md = renderReportMarkdown({
      ...baseReport,
      hookPatternArchive: [
        { pattern: '退婚-逆袭', count: 12, exampleBookKeys: ['fanqie:1'] },
      ],
    });
    expect(md).toContain('(12 本) 退婚-逆袭');
  });

  test('头部包含覆盖平台与生成时间', () => {
    const md = renderReportMarkdown(baseReport);
    expect(md).toContain('fanqie / qidian');
    expect(md).toContain('2026-05-03');
  });

  test('尾注引用 corpus collection', () => {
    const md = renderReportMarkdown(baseReport);
    expect(md).toContain('novel-trope-corpus');
  });
});
