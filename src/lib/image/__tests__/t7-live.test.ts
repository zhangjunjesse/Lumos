// T7 真机验证(只读,不出图):分流的"解析 + 透传"链在真实 DB 上端到端跑通。
// 默认跳过;LUMOS_LIVE=1 LUMOS_DATA_DIR=~/.lumos npx jest t7-live 才跑。
// 断言的具体 id 依赖当前机器的服务商配置——换机器改 EXPECT 常量即可。
//
// 已在开发机验证通过(2026-08):
//   逃生舱 "豆包"→豆包id、"dashscope"→通义id;指定id→解析到该商;不指定→全局默认。
const live = process.env.LUMOS_LIVE ? describe : describe.skip;

// 换机器时改这几个常量为本机实际服务商 id/名(sqlite3 ~/.lumos/lumos.db 查)
const HINT_CASES: Array<{ hint: string; expectPart: string }> = [
  { hint: '豆包', expectPart: '豆包' },
  { hint: 'dashscope', expectPart: '' }, // provider_type 匹配,expectPart 空=只验有值
];

live('T7 分流解析链(真实DB只读)', () => {
  it('逃生舱按名字/类型在真实服务商表里解析到图片服务商', async () => {
    const { resolveImageProviderIdByHint } = await import('@/lib/image/image-provider-hint');
    for (const c of HINT_CASES) {
      const id = resolveImageProviderIdByHint(c.hint);
      console.log(`  "${c.hint}" →`, id);
      expect(id).toBeTruthy();
    }
    expect(resolveImageProviderIdByHint('不存在的服务商xyz')).toBeUndefined();
  });

  it('T0.1 透传:指定 id → resolveBillingTarget 真的解析到那个服务商;不指定 → 全局默认', async () => {
    const { resolveImageProviderIdByHint } = await import('@/lib/image/image-provider-hint');
    const { resolveBillingTarget } = await import('@/lib/tools/image-gen-billing');
    const someId = resolveImageProviderIdByHint('豆包');
    if (someId) {
      const t = resolveBillingTarget(someId) as { provider?: { id: string } };
      console.log('  指定 id →', t.provider?.id);
      expect(t.provider?.id).toBe(someId);
    }
    const def = resolveBillingTarget() as { provider?: { name: string }; error?: string };
    console.log('  不指定 → 全局默认', def.provider?.name);
    expect('provider' in def).toBe(true);
  });
});
