'use client';

// 「加到创作助手」的 hover 加号。父元素加 className="group ...(relative)"，鼠标移上去才显示。
// 给 path → 派发 attach-file-to-chat(图作附件)；给 text → 派发 insert-text-to-chat(文字进输入框)。

import { type MouseEvent } from 'react';

export function QuickAddChat({
  text,
  path,
  imageUrl,
  refLabel,
  className = '',
  label = '加到创作助手',
}: {
  text?: string;
  path?: string | null; // 本地图路径(素材/详情图)
  imageUrl?: string | null; // 已是 url 的图(仓库生成图)
  refLabel?: string; // chip 上显示的标签，如「商品标题」「评论」「印花」
  className?: string;
  label?: string;
}) {
  const disabled = !text && !path && !imageUrl;
  const add = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (path) window.dispatchEvent(new CustomEvent('attach-image-ref-to-chat', { detail: { path, label: refLabel } }));
    else if (imageUrl) window.dispatchEvent(new CustomEvent('attach-image-ref-to-chat', { detail: { url: imageUrl, label: refLabel } }));
    if (text) window.dispatchEvent(new CustomEvent('insert-text-to-chat', { detail: { text, label: refLabel } }));
  };
  return (
    <button
      type="button"
      onClick={add}
      disabled={disabled}
      title={label}
      className={`z-10 flex size-5 items-center justify-center rounded-full bg-foreground text-background opacity-0 shadow transition hover:scale-110 group-hover:opacity-100 disabled:hidden ${className}`}
    >
      <span className="text-sm leading-none">＋</span>
    </button>
  );
}
