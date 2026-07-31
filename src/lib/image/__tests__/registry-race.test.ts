// 回归:图片服务商注册表的并发初始化竞态。团队并行出图(多设计师同时调 generate_image)
// 曾因 ensureProvidersRegistered 早置 initialized 标志,第二个并发调用者提前返回、对着空
// 注册表 resolve → 「未知的图片服务商类型…(已注册: 无)」。这是团队出图不稳定的根因之一。

import { ensureProvidersRegistered, isProviderRegistered, resolveImageProvider } from '../registry';

const REGISTRY_KEY = '__lumos_image_provider_registry';

function resetRegistry(): void {
  delete (globalThis as unknown as Record<string, unknown>)[REGISTRY_KEY];
}

describe('image provider registry 并发初始化', () => {
  beforeEach(resetRegistry);
  afterAll(resetRegistry);

  it('第二个并发调用者必须等到注册真正完成,而不是提前返回', async () => {
    // 模拟并发:第一个调用拿到 promise 但不 await,第二个立刻 await。
    // 旧代码里第二个会因 initialized=true 秒返回,此时注册表还空 → resolve 报错。
    const first = ensureProvidersRegistered();
    await ensureProvidersRegistered(); // 与 first 共享同一 promise,等到全部注册完
    expect(isProviderRegistered('toapis-image')).toBe(true);
    // resolve 不应抛「已注册: 无」
    expect(() =>
      resolveImageProvider('toapis-image', { apiKey: 'k', baseUrl: 'https://x', model: 'm' } as never),
    ).not.toThrow();
    await first;
  });

  it('10 个并发初始化后,内置服务商全部注册', async () => {
    await Promise.all(Array.from({ length: 10 }, () => ensureProvidersRegistered()));
    for (const t of ['gemini-image', 'toapis-image', 'volcengine', 'dashscope', 'openai-image', 'midjourney']) {
      expect(isProviderRegistered(t)).toBe(true);
    }
  });
});
