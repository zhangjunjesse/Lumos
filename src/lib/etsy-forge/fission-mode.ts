// 裂变·模式判定(规则,不调 AI):按方向所在「轴」推 叠加/平行/矩阵,并给出每张图的「配方」(一组方向 code)。
//  规则(对齐 playbook remix_direction_library 第2节):
//   - 0 个多选轴(每轴 ≤1) → 叠加:所有方向合成 1 张。
//   - 恰好 1 个多选轴 → 平行:该轴每个选项各出 1 张(叠上其余单选轴作固定底)。
//   - ≥2 个多选轴 → 矩阵:取前两个多选轴交叉(其余单选作固定底),总数封顶 4。
//   同轴多选=互斥档,默认平行,不强行叠加(叠加会风格打架)。

export type FissionMode = 'stack' | 'parallel' | 'matrix';
export type FissionStage = 'preview' | 'finalize' | 'iterate'; // 裂变出图阶段(纯类型,客户端/服务端共用)

export interface FissionPlan {
  mode: FissionMode;
  recipes: string[][]; // 每个 recipe = 一组方向 code,合成 1 张
  note: string; // 给用户的中文确认话术
}

const MODE_CN: Record<FissionMode, string> = { stack: '叠加', parallel: '平行', matrix: '矩阵' };
const MAX_PREVIEW = 4;

export function planFission(selected: { code: string; axis: string }[]): FissionPlan {
  if (selected.length === 0) return { mode: 'stack', recipes: [], note: '还没选方向' };

  const byAxis = new Map<string, string[]>();
  for (const s of selected) {
    const arr = byAxis.get(s.axis) ?? [];
    arr.push(s.code);
    byAxis.set(s.axis, arr);
  }
  const multiAxes = [...byAxis.values()].filter((codes) => codes.length >= 2);
  const singleCodes = [...byAxis.values()].filter((codes) => codes.length === 1).map((codes) => codes[0]);

  if (multiAxes.length === 0) {
    return { mode: 'stack', recipes: [singleCodes], note: `这些方向不冲突，按【叠加】合成 1 张` };
  }
  if (multiAxes.length >= 2) {
    const ax1 = multiAxes[0];
    const ax2 = multiAxes[1];
    const recipes: string[][] = [];
    for (const a of ax1) for (const b of ax2) recipes.push([a, b, ...singleCodes]);
    const capped = recipes.slice(0, MAX_PREVIEW);
    const over = recipes.length > MAX_PREVIEW ? `（${recipes.length} 张截到 ${MAX_PREVIEW}）` : '';
    return { mode: 'matrix', recipes: capped, note: `这是【矩阵】，${ax1.length}×${ax2.length} 交叉对比${over}，共 ${capped.length} 张` };
  }
  const axisCodes = multiAxes[0];
  const recipes = axisCodes.map((c) => [c, ...singleCodes]).slice(0, MAX_PREVIEW);
  return { mode: 'parallel', recipes, note: `同轴 ${axisCodes.length} 个方向，按【平行】各出 1 张对比，共 ${recipes.length} 张` };
}

export function modeLabel(m: FissionMode): string {
  return MODE_CN[m];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 随机生成(纯代码,AI 零参与):优先「每类随机抽 1 个、类不重复」铺满不同大类;
// n 超过大类数(8)时,再从各类剩余方向里随机补抽不重复方向,凑够 n(上限=库内方向总数)。
export function pickRandomCodes(dirs: { code: string; axis: string }[], n = 3): string[] {
  const byAxis = new Map<string, string[]>();
  for (const d of dirs) {
    const arr = byAxis.get(d.axis) ?? [];
    arr.push(d.code);
    byAxis.set(d.axis, arr);
  }
  const picked: string[] = [];
  const leftover: string[] = [];
  for (const ax of shuffle([...byAxis.keys()])) {
    const codes = shuffle(byAxis.get(ax)!);
    picked.push(codes[0]); // 每类先抽 1 个(分属不同类)
    leftover.push(...codes.slice(1)); // 类内其余方向留作补抽池
  }
  if (picked.length >= n) return picked.slice(0, n);
  // 不同类不够 n:从剩余方向随机补,直到凑够 n(都是不重复的具体方向)
  return [...picked, ...shuffle(leftover).slice(0, n - picked.length)];
}
