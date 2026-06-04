// 裂变随机抽方向(纯代码,AI 零参与)的验收:
//  - 抽 3 个,来自 3 个不同大类(天然不撞车)
//  - 都是库内有效 code
//  - 连续抽大概率不同(随机生效)
//  + 模式判定基本正确

import { pickRandomCodes, planFission } from '../fission-mode';

// 8 大类各 2-4 个方向的样例库
const LIB = [
  { code: 'A1', axis: 'A' }, { code: 'A2', axis: 'A' }, { code: 'A3', axis: 'A' },
  { code: 'B1', axis: 'B' }, { code: 'B2', axis: 'B' },
  { code: 'C1', axis: 'C' }, { code: 'C2', axis: 'C' },
  { code: 'D1', axis: 'D' }, { code: 'D2', axis: 'D' },
  { code: 'E1', axis: 'E' }, { code: 'E2', axis: 'E' },
  { code: 'F1', axis: 'F' }, { code: 'F2', axis: 'F' },
  { code: 'G1', axis: 'G' }, { code: 'G2', axis: 'G' },
  { code: 'H1', axis: 'H' }, { code: 'H2', axis: 'H' },
];
const axisOf = new Map(LIB.map((d) => [d.code, d.axis]));

describe('pickRandomCodes', () => {
  it('抽 3 个、分属 3 个不同大类、都是库内有效 code', () => {
    for (let t = 0; t < 200; t++) {
      const codes = pickRandomCodes(LIB, 3);
      expect(codes).toHaveLength(3);
      const axes = codes.map((c) => axisOf.get(c));
      expect(new Set(axes).size).toBe(3); // 3 个不同大类
      for (const c of codes) expect(axisOf.has(c)).toBe(true); // 库内有效
    }
  });

  it('连续两次大概率不同(随机生效)', () => {
    let diff = 0;
    for (let t = 0; t < 50; t++) {
      const a = pickRandomCodes(LIB, 3).join(',');
      const b = pickRandomCodes(LIB, 3).join(',');
      if (a !== b) diff++;
    }
    expect(diff).toBeGreaterThan(40); // 绝大多数不同
  });

  it('n 超过大类数(8)时,先铺满不同类再补抽不重复方向,凑够 n、无重复', () => {
    for (let t = 0; t < 100; t++) {
      const codes = pickRandomCodes(LIB, 10); // LIB 17 个方向、8 大类
      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10); // 方向不重复
      // 前 8 个应覆盖全部 8 个不同大类(铺满)
      const first8Axes = codes.slice(0, 8).map((c) => axisOf.get(c));
      expect(new Set(first8Axes).size).toBe(8);
    }
  });

  it('n 超过库内方向总数时,最多返回总数,不重复不报错', () => {
    const codes = pickRandomCodes(LIB, 99);
    expect(codes).toHaveLength(LIB.length);
    expect(new Set(codes).size).toBe(LIB.length);
  });

  it('库不足 n 类时,有几个抽几个,不报错', () => {
    expect(pickRandomCodes([{ code: 'A1', axis: 'A' }, { code: 'B1', axis: 'B' }], 3)).toHaveLength(2);
    expect(pickRandomCodes([], 3)).toHaveLength(0);
  });
});

describe('planFission', () => {
  it('跨轴单选 → 叠加 1 张', () => {
    expect(planFission([{ code: 'A1', axis: 'A' }, { code: 'B1', axis: 'B' }]).mode).toBe('stack');
  });
  it('同轴多选 → 平行各 1 张', () => {
    const p = planFission([{ code: 'A1', axis: 'A' }, { code: 'A2', axis: 'A' }]);
    expect(p.mode).toBe('parallel');
    expect(p.recipes).toHaveLength(2);
  });
  it('两轴各 ≥2 → 矩阵交叉(封顶 4)', () => {
    const p = planFission([
      { code: 'A1', axis: 'A' }, { code: 'A2', axis: 'A' },
      { code: 'B1', axis: 'B' }, { code: 'B2', axis: 'B' },
    ]);
    expect(p.mode).toBe('matrix');
    expect(p.recipes.length).toBeLessThanOrEqual(4);
  });
});
