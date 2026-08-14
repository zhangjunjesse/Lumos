/**
 * Image provider registry — singleton factory registry.
 *
 * Uses globalThis to survive Next.js dev-mode module reloads.
 * Providers register via registerImageProvider(); consumers resolve via resolveImageProvider().
 */

import type { ImageProviderKindId } from '@/lib/provider-kinds'
import type { ImageProvider, ImageProviderConfig, ImageProviderFactory } from './types'
import { ImageGenError } from './types'

const REGISTRY_KEY = '__lumos_image_provider_registry'

interface RegistryState {
  factories: Map<string, ImageProviderFactory>
  initPromise: Promise<void> | null // 进行中的初始化 promise;并发调用者共享同一个,避免注册竞态
}

function getState(): RegistryState {
  const g = globalThis as unknown as Record<string, unknown>
  if (!g[REGISTRY_KEY]) {
    g[REGISTRY_KEY] = { factories: new Map<string, ImageProviderFactory>(), initPromise: null }
  }
  return g[REGISTRY_KEY] as RegistryState
}

export function registerImageProvider(type: string, factory: ImageProviderFactory): void {
  getState().factories.set(type, factory)
}

export function resolveImageProvider(type: string, config: ImageProviderConfig): ImageProvider {
  const { factories } = getState()
  const factory = factories.get(type)
  if (!factory) {
    throw new ImageGenError(
      'invalid_params',
      `未知的图片服务商类型: ${type}（已注册: ${[...factories.keys()].join(', ') || '无'}）`,
    )
  }
  return factory(config)
}

export function getRegisteredProviderTypes(): string[] {
  return [...getState().factories.keys()]
}

export function isProviderRegistered(type: string): boolean {
  return getState().factories.has(type)
}

/**
 * Initialize built-in providers. Called lazily on first resolve.
 * Import here to keep registry.ts dependency-free at module level.
 *
 * 并发安全:memoize 进行中的 promise。此前用 `initialized=true` 早置标志——它在
 * `await import()` 完成注册之前就置真,并发的第二个调用者会看到标志为真提前返回,
 * 然后对着还空的注册表 resolve,报「未知的图片服务商类型…(已注册: 无)」。团队并行
 * 出图(多个设计师同时调 generate_image)必然触发,是团队出图不稳定的根因之一。
 */
export async function ensureProvidersRegistered(): Promise<void> {
  const state = getState()
  if (!state.initPromise) {
    state.initPromise = registerBuiltins().catch((err) => {
      state.initPromise = null // 初始化失败(如 import 抖动)重置,下次可重试,不永久卡死
      throw err
    })
  }
  await state.initPromise
}

/**
 * 内置适配器加载器,键必须覆盖 provider-kinds 里全部 image-gen 类型 ——
 * `Record<ImageProviderKindId, …>` 焊死:kinds 加了图片类型而这里没配适配器,编译报错;
 * 反之这里出现 kinds 不认识的键,同样编译报错。运行时不再有第二张手写清单可漂移。
 */
const BUILTIN_IMAGE_ADAPTERS: Record<ImageProviderKindId, () => Promise<ImageProviderFactory>> = {
  'gemini-image': async () => (await import('./providers/gemini')).createGeminiProvider,
  'toapis-image': async () => (await import('./providers/toapis')).createToApisProvider,
  'volcengine': async () => (await import('./providers/volcengine')).createVolcengineProvider,
  'dashscope': async () => (await import('./providers/dashscope')).createDashScopeProvider,
  'openai-image': async () => (await import('./providers/openai-image')).createOpenAIImageProvider,
  'midjourney': async () => (await import('./providers/midjourney')).createMidjourneyProvider,
}

async function registerBuiltins(): Promise<void> {
  await Promise.all(
    (Object.entries(BUILTIN_IMAGE_ADAPTERS) as Array<[ImageProviderKindId, () => Promise<ImageProviderFactory>]>)
      .map(async ([type, load]) => registerImageProvider(type, await load())),
  )
}
