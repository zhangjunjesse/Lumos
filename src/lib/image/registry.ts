/**
 * Image provider registry — singleton factory registry.
 *
 * Uses globalThis to survive Next.js dev-mode module reloads.
 * Providers register via registerImageProvider(); consumers resolve via resolveImageProvider().
 */

import type { ImageProvider, ImageProviderConfig, ImageProviderFactory } from './types'
import { ImageGenError } from './types'

const REGISTRY_KEY = '__lumos_image_provider_registry'

interface RegistryState {
  factories: Map<string, ImageProviderFactory>
  initialized: boolean
}

function getState(): RegistryState {
  const g = globalThis as unknown as Record<string, unknown>
  if (!g[REGISTRY_KEY]) {
    g[REGISTRY_KEY] = { factories: new Map<string, ImageProviderFactory>(), initialized: false }
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
 */
export async function ensureProvidersRegistered(): Promise<void> {
  const state = getState()
  if (state.initialized) return
  state.initialized = true

  const { createGeminiProvider } = await import('./providers/gemini')
  const { createVolcengineProvider } = await import('./providers/volcengine')
  const { createDashScopeProvider } = await import('./providers/dashscope')

  registerImageProvider('gemini-image', createGeminiProvider)
  registerImageProvider('volcengine', createVolcengineProvider)
  registerImageProvider('dashscope', createDashScopeProvider)
}
