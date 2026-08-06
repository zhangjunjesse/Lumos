/**
 * 图片服务商"就近原则"解析 —— 按调用者分流的唯一决定点。
 *
 * 全仓只此一处决定"这次出图用哪个服务商",各调用点(聊天/团队/etsy-forge)只负责
 * 把自己的上下文喂进来,不各自散写 if。保持纯函数(不查 DB),便于测全部优先级组合。
 *
 * 优先级(高 → 低):
 *   1. AI 运行时明确指定(逃生舱,用户在聊天里明说"这张用 MJ")
 *   2. 分场景:
 *      - 有团队(成员出图):成员绑的 → 团队默认
 *      - 无团队(主 AI 出图):会话选的
 *   3. 全局默认 —— 返回 undefined,交给 generateImages 走 provider_override:image
 *
 * 返回 undefined 的语义是"没有更近的配置",不是"出错";上层据此回退全局默认。
 * 有团队时刻意不看会话级选择:团队的意义是各成员各司其职,会话级覆盖会打乱分工
 * (对应对话框在团队模式下把图片服务商选择器置灰的设计)。
 *
 * 本文件保持纯函数(零 DB 依赖);"名字→id"的逃生舱解析在 image-provider-hint.ts。
 */

export interface ImageProviderResolveContext {
  /** AI 运行时明确指定(逃生舱),最高优先级 */
  explicitProviderId?: string | null
  /** 是否团队场景(成员出图)。true 走成员/团队链,false 走会话链。 */
  hasTeam?: boolean
  /** 成员绑的图片服务商(仅团队场景有意义) */
  memberImageProviderId?: string | null
  /** 团队默认图片服务商(成员没绑时的兜底) */
  teamDefaultImageProviderId?: string | null
  /** 会话选的图片服务商(仅裸聊天有意义) */
  sessionImageProviderId?: string | null
}

/** 空串/空白/null 一律归一成 undefined —— DB 里未配置存的是空串。 */
function clean(value?: string | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

export function resolveImageProviderId(ctx: ImageProviderResolveContext): string | undefined {
  const explicit = clean(ctx.explicitProviderId)
  if (explicit) return explicit

  if (ctx.hasTeam) {
    return clean(ctx.memberImageProviderId) ?? clean(ctx.teamDefaultImageProviderId)
  }
  return clean(ctx.sessionImageProviderId)
}
