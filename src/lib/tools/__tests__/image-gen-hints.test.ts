import { IMAGE_GEN_IN_PROCESS_HINT } from '../image-gen-hints';

// 瘦身（删掉两段与 tool input schema 重复的参数百科）后，这些行为策略必须仍在——
// 它们不在 schema 里、是 hint 的真正价值，误删会回退历史修复。
describe('IMAGE_GEN_IN_PROCESS_HINT — 瘦身后保留行为策略', () => {
  it('保留路径提取铁律（防 provider 收到空 reference_image_paths 而瞎编）', () => {
    expect(IMAGE_GEN_IN_PROCESS_HINT).toContain('CRITICAL path-extraction');
    expect(IMAGE_GEN_IN_PROCESS_HINT).toContain('reference_image_paths');
  });

  it('保留计费与配额诚实性规则', () => {
    expect(IMAGE_GEN_IN_PROCESS_HINT).toContain('billed per generated');
    expect(IMAGE_GEN_IN_PROCESS_HINT).toMatch(/generation_count\/generation_limit/);
  });

  it('保留中文尺寸映射与「禁输出 fenced 计划块」', () => {
    expect(IMAGE_GEN_IN_PROCESS_HINT).toContain('宽屏');
    expect(IMAGE_GEN_IN_PROCESS_HINT).toContain('image-gen-request');
  });

  it('保留中文触发词，参数细节改为指向 tool input schema（不再重述参数百科）', () => {
    expect(IMAGE_GEN_IN_PROCESS_HINT).toContain('连续插图');
    expect(IMAGE_GEN_IN_PROCESS_HINT).toContain('input schema');
    // 与 schema 重复的枚举堆砌已删除，确认瘦身真的发生。
    expect(IMAGE_GEN_IN_PROCESS_HINT).not.toContain('BLOCK_LOW_AND_ABOVE');
  });

  it('整体显著变短（删了约 2k 字符的重复参数说明）', () => {
    expect(IMAGE_GEN_IN_PROCESS_HINT.length).toBeLessThan(4200);
  });
});
