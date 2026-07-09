import {
  IMAGE_GEN_IN_PROCESS_HINT,
  MEDIA_GEN_IN_PROCESS_HINT,
  VIDEO_GEN_IN_PROCESS_HINT,
} from '../image-gen-hints';

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

  it('保留 safety_settings 的「仅在用户明确要求时才放宽」安全门槛（行为策略，非参数百科）', () => {
    // 这条是唯一阻止模型无端调低 Gemini 内容审核阈值的防线，瘦身时不能连它一起删。
    expect(IMAGE_GEN_IN_PROCESS_HINT).toContain('safety_settings');
    expect(IMAGE_GEN_IN_PROCESS_HINT).toMatch(/do NOT set safety_settings unless the user explicitly asks/i);
  });

  it('保留 region_edit_bbox 坐标是像素（schema 未说，模型调用前需要）', () => {
    expect(IMAGE_GEN_IN_PROCESS_HINT).toMatch(/pixels/i);
  });

  it('整体显著变短（删了约 2k 字符的重复参数说明）', () => {
    expect(IMAGE_GEN_IN_PROCESS_HINT.length).toBeLessThan(4200);
  });

  it('视频提示不混入图片常量（各自独立，防止再次撑爆瘦身护栏）', () => {
    expect(IMAGE_GEN_IN_PROCESS_HINT).not.toContain('generate_video');
  });
});

// 视频提示是独立常量：锁行为策略与体积，组合常量供 lumos-image server 消费点使用。
describe('VIDEO_GEN_IN_PROCESS_HINT — 行为策略', () => {
  it('保留直接调用规则与「不走 chat/completions」', () => {
    expect(VIDEO_GEN_IN_PROCESS_HINT).toContain('generate_video');
    expect(VIDEO_GEN_IN_PROCESS_HINT).toContain('chat/completions');
  });

  it('保留 wan2.6-flash 需参考素材的模型能力规则', () => {
    expect(VIDEO_GEN_IN_PROCESS_HINT).toContain('wan2.6-flash');
    expect(VIDEO_GEN_IN_PROCESS_HINT).toContain('gemini_omni_flash');
  });

  it('保留中文尺寸/时长映射与计费诚实性规则', () => {
    expect(VIDEO_GEN_IN_PROCESS_HINT).toContain('横版');
    expect(VIDEO_GEN_IN_PROCESS_HINT).toContain('billed per second');
  });

  it('体积受控（行为策略级提示，不是参数百科）', () => {
    expect(VIDEO_GEN_IN_PROCESS_HINT.length).toBeLessThan(1600);
  });

  it('组合常量同时含图片与视频提示', () => {
    expect(MEDIA_GEN_IN_PROCESS_HINT).toContain('CRITICAL path-extraction');
    expect(MEDIA_GEN_IN_PROCESS_HINT).toContain('generate_video');
  });
});
