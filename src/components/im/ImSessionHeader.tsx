'use client';

import { useEffectiveImProvider } from '@/hooks/useEffectiveImProvider';
import { pickImHeaderSlot } from './header-dispatch';
import { WechatChatHeader } from './providers/wechat/Header';
import { FeishuChatHeader } from './providers/feishu/Header';

/**
 * Single IM control slot for the chat / main-agent session header.
 *
 * 设计原则（user 决策）：一次只展示一个 IM 的入口。哪个由 effective default
 * 决定（im.default → first enabled → null）。同时启用多个 IM 时，header 仍
 * 然只显示 default 那一侧；要切换 UI 入口必须改 default。
 *
 * 加新 provider 的方式：
 *   1. 在 src/components/im/providers/<id>/Header.tsx 实现 client component
 *   2. 在 header-dispatch.ts 的 pickImHeaderSlot 加一行
 *   3. 在下面的 switch 里加一行
 *   4. ChatView 不动
 */
export function ImSessionHeader({ sessionId }: { sessionId: string }) {
  const provider = useEffectiveImProvider();
  const slot = pickImHeaderSlot(provider);
  switch (slot) {
    case 'wechat':
      return <WechatChatHeader sessionId={sessionId} />;
    case 'feishu':
      return <FeishuChatHeader sessionId={sessionId} />;
    case 'none':
    default:
      return null;
  }
}
