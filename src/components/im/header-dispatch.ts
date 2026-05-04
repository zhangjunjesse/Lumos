/**
 * Decide which IM-specific header slot the chat page should render.
 *
 * Pure function so it can be unit-tested without a DOM. ImSessionHeader simply
 * forwards to the matching component.
 *
 * Rules:
 *   - one IM at a time (user 决策)；effective ID 由 useEffectiveImProvider 提供
 *   - 未注册的 provider id（未来类型 / 拼写错误）→ none
 */

export type ImHeaderSlot = 'none' | 'wechat' | 'feishu';

export function pickImHeaderSlot(effectiveProvider: string | null | undefined): ImHeaderSlot {
  switch (effectiveProvider) {
    case 'wechat': return 'wechat';
    case 'feishu': return 'feishu';
    default: return 'none';
  }
}
