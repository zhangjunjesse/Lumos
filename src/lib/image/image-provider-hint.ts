/**
 * AI 逃生舱:把用户口头说的服务商(名字/类型,如 "MJ"、"midjourney"、"豆包")解析成
 * provider id。只在支持 image-gen 的服务商里按 name / provider_type 大小写不敏感匹配。
 *
 * 契约(issue #64 后收紧):显式指定是最高优先级的用户意图,匹配不到时**不再静默
 * 回落默认服务商**——那会让用户以为拿到了 MJ 的图,实际是别家画的还照常扣费。
 * 现在返回结构化的 not_found(带当前可用服务商清单),由调用方硬报错,AI 拿到
 * 清单可以当场纠正重试。模糊(包含)匹配只作为 not_found 里的 didYouMean 建议,
 * 不再自动采用。
 *
 * 与 image-provider-resolver 分开是为了让后者保持纯函数、零 DB 依赖;这里要查服务商表。
 */

import { getAllProviders } from '@/lib/db/providers'
import { providerSupportsCapability } from '@/lib/provider-config'

export type ExplicitImageProviderResolution =
  /** 未给 hint:走就近链,不属于显式指定 */
  | { kind: 'none' }
  | { kind: 'ok'; providerId: string; providerName: string }
  | {
      kind: 'not_found'
      requested: string
      /** 当前所有可用的出图服务商(name + type),供报错展示与 AI 自纠 */
      available: Array<{ name: string; type: string }>
      /** 名字片段能对上的候选(原"包含匹配"降级为建议) */
      didYouMean?: string
    }

export function resolveExplicitImageProvider(hint: string | undefined): ExplicitImageProviderResolution {
  const needle = hint?.trim().toLowerCase()
  if (!needle) return { kind: 'none' }

  const imageProviders = getAllProviders().filter((p) => providerSupportsCapability(p, 'image-gen'))
  const exact = imageProviders.find(
    (p) => p.name.toLowerCase() === needle || p.provider_type.toLowerCase() === needle,
  )
  if (exact) return { kind: 'ok', providerId: exact.id, providerName: exact.name }

  const partial = imageProviders.find(
    (p) => p.name.toLowerCase().includes(needle) || p.provider_type.toLowerCase().includes(needle),
  )
  return {
    kind: 'not_found',
    requested: hint!.trim(),
    available: imageProviders.map((p) => ({ name: p.name, type: p.provider_type })),
    ...(partial ? { didYouMean: partial.name } : {}),
  }
}

/**
 * 校验绑定的图片服务商 id 仍然可用(存在且支持 image-gen)。
 * 不可用返回 undefined(回退全局默认)并留痕 —— 会话/团队里存的绑定是历史值,
 * 服务商事后被删除/改能力时,出图应该降级而不是从此张张报「指定服务商已删除」。
 * 注意与显式指定的语义区别:绑定失效是历史配置过期,降级合理;显式指定失败是
 * 当下的用户意图落空,必须硬报错(见 resolveExplicitImageProvider)。
 */
export function sanitizeImageProviderId(id: string | undefined | null, sourceLabel: string): string | undefined {
  const normalized = id?.trim()
  if (!normalized) return undefined
  const provider = getAllProviders().find((p) => p.id === normalized)
  if (!provider || !providerSupportsCapability(provider, 'image-gen')) {
    console.warn(`[image-provider] ${sourceLabel}绑定的图片服务商已不可用(${normalized}),回退全局默认`)
    return undefined
  }
  return normalized
}
