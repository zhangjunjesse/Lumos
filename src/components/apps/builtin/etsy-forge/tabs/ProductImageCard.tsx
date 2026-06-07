'use client';

// 「我的产品」一张产品图卡片:成品图 + 评分(角标显示当前分,hover 出 1-10 打分条) + 加创作 + 删除 + 重合成中态。

import { QuickAddChat } from './QuickAddChat';
import { ScoreBar } from './ScoreBar';
import type { MockupItem } from '../api-client';

export function ProductImageCard({
  m,
  size,
  retrying,
  onOpen,
  onDelete,
  onScore,
}: {
  m: MockupItem;
  size: number;
  retrying: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onScore: (n: number) => void;
}) {
  return (
    <div style={{ width: size, height: size }} className={`group relative shrink-0 overflow-hidden rounded border bg-card ${retrying ? 'ring-2 ring-amber-500' : ''}`}>
      {retrying && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 bg-amber-500/35">
          <span className="size-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
          <span className="rounded bg-amber-600 px-1.5 py-0.5 text-[9px] font-medium text-white">重试中…</span>
        </div>
      )}
      {m.status === 'success' && m.url ? (
        <>
          <button type="button" onClick={onOpen} title="点击看溯源" className="block size-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.url} alt={m.design_label} className="size-full object-cover" />
          </button>
          <QuickAddChat imageUrl={m.url} refLabel="带印花T" className="absolute right-0.5 top-0.5" />
          {/* 当前分角标(没 hover 时显示) */}
          {m.score > 0 && (
            <span className="absolute bottom-0.5 left-0.5 flex size-5 items-center justify-center rounded bg-foreground text-[11px] font-medium text-background group-hover:opacity-0" title={`评分 ${m.score}`}>
              {m.score}
            </span>
          )}
          {/* hover 出底部细评分条(不挡图) */}
          <div className="absolute inset-x-0 bottom-0 opacity-0 transition group-hover:opacity-100">
            <ScoreBar value={m.score} onPick={onScore} />
          </div>
        </>
      ) : (
        <div className="flex size-full items-center justify-center bg-destructive/5 p-1 text-center text-[8px] text-destructive">{m.failure_reason || '失败'}</div>
      )}
      <button type="button" onClick={onDelete} className="absolute left-0.5 top-0.5 rounded bg-black/50 px-1 text-[8px] text-white opacity-0 transition group-hover:opacity-100">
        删
      </button>
    </div>
  );
}
