'use client';

import { WechatRouteIndicator } from '@/components/chat/WechatRouteIndicator';

/**
 * WeChat 在 chat header 上的入口：
 * 当前路由徽章（read-only：用户在微信发 /switch 才能改路由）。
 * 未来可以在这里加快捷操作，比如「跳到 ClawBot 对话」。
 */
export function WechatChatHeader({ sessionId }: { sessionId: string }) {
  return <WechatRouteIndicator sessionId={sessionId} />;
}
