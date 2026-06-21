// generate_image 工具的输入处理:
//  - coerceStringArray: MCP/模型常把数组传成字符串,归一化成数组(避免 z.array 拒收导致创作助手空转重试)
//  - findUnreferencedPromptPaths: 只拦 prompt 里有、但没放进 reference_image_paths 的路径(#28 图生图误拦)

import { coerceStringArray } from '../image-gen-arg-coerce';
import { findUnreferencedPromptPaths } from '../image-gen-path-guard';

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

describe('findUnreferencedPromptPaths (#28 图生图参考图被误判为 prompt 非法路径)', () => {
  it('prompt 里的路径已在 reference_image_paths 里 → 不拦(放行图生图)', () => {
    expect(findUnreferencedPromptPaths(
      'Edit the photo at /Users/x/room.jpg to add a lamp',
      ['/Users/x/room.jpg'],
    )).toEqual([]);
  });

  it('Windows 路径 + 斜杠方向/大小写差异也算已覆盖', () => {
    expect(findUnreferencedPromptPaths(
      'Edit C:\\Users\\Admin\\room_base.jpg',
      ['c:/users/admin/room_base.jpg'],
    )).toEqual([]);
  });

  it('prompt 有路径但 reference_image_paths 没有 → 仍拦(真漏传)', () => {
    expect(findUnreferencedPromptPaths(
      'Use /Users/x/a.jpg and /Users/x/b.jpg',
      ['/Users/x/a.jpg'],
    )).toEqual(['/Users/x/b.jpg']);
  });

  it('reference_image_paths 为空 + prompt 有路径 → 全拦', () => {
    expect(findUnreferencedPromptPaths('Use /Users/x/a.jpg', [])).toEqual(['/Users/x/a.jpg']);
  });

  it('prompt 无路径 → 空(纯文字生成不受影响)', () => {
    expect(findUnreferencedPromptPaths('Edit Image 1, add a lamp', ['/Users/x/a.jpg'])).toEqual([]);
  });
});
