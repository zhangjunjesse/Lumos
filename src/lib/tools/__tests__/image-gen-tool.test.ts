// generate_image 工具的 reference_image_paths 容错:MCP/模型常把数组传成字符串,
// coerceStringArray 要把各种形态都归一化成数组,避免严格 z.array 拒收导致创作助手空转重试。

import { coerceStringArray } from '../image-gen-arg-coerce';

describe('coerceStringArray', () => {
  it('数组原样通过', () => {
    expect(coerceStringArray(['/a.png', '/b.png'])).toEqual(['/a.png', '/b.png']);
  });
  it('整串 JSON 数组 → 解析成数组', () => {
    expect(coerceStringArray('["/a.png","/b.png"]')).toEqual(['/a.png', '/b.png']);
  });
  it('单个路径字符串 → 包成单元素数组', () => {
    expect(coerceStringArray('/Users/x/a.png')).toEqual(['/Users/x/a.png']);
  });
  it('逗号分隔字符串 → 拆成数组', () => {
    expect(coerceStringArray('/a.png, /b.png')).toEqual(['/a.png', '/b.png']);
  });
  it('空字符串 → undefined(可选不传)', () => {
    expect(coerceStringArray('   ')).toBeUndefined();
  });
  it('非法 JSON 数组串当单值/分隔处理,不崩', () => {
    expect(coerceStringArray('[not json')).toEqual(['[not json']);
  });
  it('undefined 原样', () => {
    expect(coerceStringArray(undefined)).toBeUndefined();
  });
});
