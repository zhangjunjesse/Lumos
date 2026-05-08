'use client';
/* eslint-disable @next/next/no-img-element -- 闲鱼远程 CDN 商品图，无法走 next/image */

import { GoofishAvatar } from './GoofishAvatar';

export interface ChatSessionLite {
  session_id: string;
  peer_nick: string;
  peer_user_id: string;
  peer_avatar: string;
  unread: number;
  last_msg: string;
  ts: number;
  session_type: number;
  item_id: string;
  item_title: string;
  item_main_pic: string;
  // 该会话归属哪个 Lumos 账号(unb)。多账号 "全部" 视图必须靠它定位
  // 选中 session 的拥有者,否则消息气泡 fromMe 判定会错。
  account_unb: string;
}

export function ChatRow({ session, onClick }: { session: ChatSessionLite; onClick: () => void }) {
  const isSkeleton = !session.peer_nick && !session.last_msg;
  const nick = session.peer_nick
    || (isSkeleton && session.peer_user_id ? `用户 ${session.peer_user_id}` : '')
    || (isSkeleton ? `会话 #${session.session_id}` : '(未知)');
  const preview = session.last_msg || (isSkeleton ? '点击查看消息' : '(无消息)');
  const time = formatChatTime(session.ts);
  const hasUnread = session.unread > 0;

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 active:bg-muted/50 cursor-pointer transition-colors"
    >
      <GoofishAvatar userId={session.peer_user_id} name={nick} avatarUrl={session.peer_avatar} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-sm truncate">{nick}</span>
          <span className="text-xs text-muted-foreground shrink-0">{time}</span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground truncate">{preview}</span>
          {hasUnread && (
            <span className="shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-medium flex items-center justify-center">
              {session.unread > 99 ? '99+' : session.unread}
            </span>
          )}
        </div>
        {(session.item_title || session.item_main_pic) && (
          <div className="flex items-center gap-1.5 mt-1.5 px-2 py-1 bg-muted/40 rounded text-[11px] max-w-full">
            {session.item_main_pic && (
              <img
                src={session.item_main_pic}
                alt=""
                referrerPolicy="no-referrer"
                className="h-6 w-6 rounded object-cover shrink-0"
              />
            )}
            <span className="truncate text-muted-foreground">
              {session.item_title || `商品 #${session.item_id}`}
            </span>
          </div>
        )}
      </div>
    </li>
  );
}

export function formatRelativeTime(ts: number): string {
  if (!ts) return '从未';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / 60 / 60_000)} 小时前`;
  return formatChatTime(ts);
}

export function formatChatTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate();
  if (isYesterday) return '昨天';
  if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
