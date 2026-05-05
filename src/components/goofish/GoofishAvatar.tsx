'use client';
/* eslint-disable @next/next/no-img-element -- 闲鱼远程 CDN 头像/图片走 referrerPolicy=no-referrer，next/image 不支持 */

import { useState } from 'react';

/**
 * 闲鱼用户头像。优先拉真实头像 (wwc.alicdn.com 的 getAvatar.do)，
 * 加载失败或没有 userId 时降级到带首字母的彩色色块。
 *
 * referrerPolicy="no-referrer" 是必须的——阿里 CDN 对 referrer 有时挑食，
 * 不带 referrer 反而最稳。
 */
interface Props {
  userId?: string;
  name?: string;
  /** 直接 CDN URL（baseline session.userInfo.logo 之类）。优先级最高。 */
  avatarUrl?: string;
  size?: number;
  className?: string;
}

const PALETTE = [
  'bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-emerald-500',
  'bg-cyan-500', 'bg-blue-500', 'bg-indigo-500', 'bg-purple-500',
];

function colorOf(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function firstChar(s: string): string {
  for (const ch of s) return ch;
  return '?';
}

export function GoofishAvatar({ userId, name = '', avatarUrl, size = 40, className = '' }: Props) {
  const [errored, setErrored] = useState(false);
  const dim = `${size}px`;
  const src = !errored
    ? (avatarUrl || (userId ? `https://wwc.alicdn.com/avatar/getAvatar.do?userId=${userId}&width=120&height=120` : ''))
    : '';

  if (src) {
    return (
      <img
        src={src}
        alt={name || userId || ''}
        referrerPolicy="no-referrer"
        onError={() => setErrored(true)}
        className={`rounded-full object-cover shrink-0 ${className}`}
        style={{ width: dim, height: dim }}
      />
    );
  }

  const seed = userId || name || '?';
  return (
    <div
      className={`rounded-full shrink-0 flex items-center justify-center text-white font-medium ${colorOf(seed)} ${className}`}
      style={{ width: dim, height: dim, fontSize: `${Math.round(size * 0.4)}px` }}
    >
      {firstChar(name || '?')}
    </div>
  );
}
