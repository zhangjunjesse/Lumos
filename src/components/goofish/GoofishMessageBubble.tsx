'use client';
/* eslint-disable @next/next/no-img-element -- 闲鱼远程 CDN 图片需要 referrerPolicy=no-referrer */

import { GoofishAvatar } from './GoofishAvatar';

export type GoofishMessageContent =
  | { kind: 'text'; text: string }
  | { kind: 'image'; url: string; width: number; height: number }
  | { kind: 'item'; itemId: string; price: string; title: string; mainPic: string; tip?: string }
  | { kind: 'system'; text: string }
  | { kind: 'unknown'; raw: string };

export interface GoofishChatMessage {
  messageId: string;
  fromUserId: string;
  fromUserName: string;
  createdAt: number;
  readStatus: number;
  summary?: string;
  content: GoofishMessageContent;
}

export function MessageBubble({ message, fromMe }: { message: GoofishChatMessage; fromMe: boolean }) {
  const c = message.content;

  // 系统提示居中，不显示头像、不显示时间
  if (c.kind === 'system') {
    return (
      <div className="flex justify-center my-2">
        <div className="text-[11px] text-muted-foreground bg-muted/40 px-3 py-1 rounded-full max-w-[80%] text-center">
          {c.text}
        </div>
      </div>
    );
  }

  const time = message.createdAt ? formatBubbleTime(message.createdAt) : '';
  // readStatus: 1 = read by peer, 2 = sent but not yet read. Only render
  // the ticks for messages I sent (peer's incoming readStatus is irrelevant).
  const readMark = fromMe && message.readStatus === 1 ? '已读' : (fromMe && message.readStatus === 2 ? '未读' : '');

  return (
    <div className={`flex gap-2 items-end ${fromMe ? 'justify-end' : 'justify-start'}`}>
      {!fromMe && <GoofishAvatar userId={message.fromUserId} name={message.fromUserName} size={32} />}
      <div className={`flex flex-col gap-0.5 max-w-[70%] ${fromMe ? 'items-end' : 'items-start'}`}>
        <BubbleContent content={c} fromMe={fromMe} />
        {(time || readMark) && (
          <div className="text-[10px] text-muted-foreground px-1 flex gap-1.5">
            {time && <span>{time}</span>}
            {readMark && <span className={readMark === '已读' ? 'text-blue-500' : ''}>{readMark}</span>}
          </div>
        )}
      </div>
      {fromMe && <GoofishAvatar userId={message.fromUserId} name={message.fromUserName} size={32} />}
    </div>
  );
}

function BubbleContent({ content: c, fromMe }: { content: GoofishMessageContent; fromMe: boolean }) {
  const bubble = fromMe ? 'bg-blue-500 text-white' : 'bg-card border border-border/60';
  if (c.kind === 'text') {
    return (
      <div className={`${bubble} px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words`}>
        {c.text}
      </div>
    );
  }
  if (c.kind === 'image') {
    return (
      <div className={`${bubble} p-1 rounded-xl overflow-hidden`}>
        {c.url ? (
          <img src={c.url} alt="" referrerPolicy="no-referrer" className="rounded-lg max-h-64 w-auto" />
        ) : (
          <div className="px-3 py-2 text-sm">[图片]</div>
        )}
      </div>
    );
  }
  if (c.kind === 'item') {
    return (
      <div className={`${bubble} p-2 rounded-xl flex gap-2`}>
        {c.mainPic && (
          <img src={c.mainPic} alt="" referrerPolicy="no-referrer" className="h-16 w-16 rounded object-cover shrink-0" />
        )}
        <div className="min-w-0 flex flex-col justify-between">
          {c.tip && <div className="text-xs opacity-80">{c.tip}</div>}
          <div className="text-sm truncate">{c.title || '(商品)'}</div>
          <div className="text-sm font-medium">{c.price}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={`${bubble} px-3 py-2 rounded-xl text-xs italic opacity-70`}>
      [不支持的消息类型]
    </div>
  );
}

export function formatBubbleTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const yd = new Date(now); yd.setDate(now.getDate() - 1);
  if (d.getFullYear() === yd.getFullYear() && d.getMonth() === yd.getMonth() && d.getDate() === yd.getDate()) {
    return `昨天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (d.getFullYear() === now.getFullYear()) {
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
