/**
 * AI 逃生舱:把用户口头说的服务商(名字/类型,如 "MJ"、"midjourney"、"豆包")解析成
 * provider id。只在支持 image-gen 的服务商里按 name / provider_type 大小写不敏感匹配。
 * 匹配不到返回 undefined(尽力而为,不报错,回落就近链)——逃生舱不该因写错名字就中断出图。
 *
 * 与 image-provider-resolver 分开是为了让后者保持纯函数、零 DB 依赖;这里要查服务商表。
 */

import { getAllProviders } from '@/lib/db/providers'
import { providerSupportsCapability } from '@/lib/provider-config'

export function resolveImageProviderIdByHint(hint: string | undefined): string | undefined {
  const needle = hint?.trim().toLowerCase()
  if (!needle) return undefined

  const imageProviders = getAllProviders().filter((p) => providerSupportsCapability(p, 'image-gen'))
  // 优先精确(name 或 type 完全相等),再退而求其次做包含匹配
  const exact = imageProviders.find(
    (p) => p.name.toLowerCase() === needle || p.provider_type.toLowerCase() === needle,
  )
  if (exact) return exact.id
  const partial = imageProviders.find(
    (p) => p.name.toLowerCase().includes(needle) || p.provider_type.toLowerCase().includes(needle),
  )
  return partial?.id
}
