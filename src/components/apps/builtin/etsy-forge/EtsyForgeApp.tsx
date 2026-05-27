'use client';

// Etsy AI 出图 — 主刷图入口
// 全屏单图 + 👎/👍 + 左右滑手势 + 键盘 ← / → + 预生成下一批
// 6 状态 UI：loading / showing / batch-done / quota-exhausted / image-failed / network-down
// 严禁任何输入框、选项、营销话术、鼓励 emoji。

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { etsyForgeApi, type BatchImage, type BatchResult } from './api-client';

type AppPhase =
  | { kind: 'loading' }
  | { kind: 'showing'; batch: BatchResult; index: number }
  | { kind: 'batch-done' }
  | { kind: 'quota-exhausted'; reason: string }
  | { kind: 'image-failed'; reason: string }
  | { kind: 'network-down'; reason: string };

const PREFETCH_AT_INDEX = 30;

export function EtsyForgeApp() {
  const [phase, setPhase] = useState<AppPhase>({ kind: 'loading' });
  const [nextBatch, setNextBatch] = useState<BatchResult | null>(null);
  const [todayLiked, setTodayLiked] = useState(0);
  const [todaySwiped, setTodaySwiped] = useState(0);
  const prefetchingRef = useRef(false);

  const loadBatch = useCallback(async (allowEmpty = false): Promise<BatchResult | null> => {
    try {
      const batch = await etsyForgeApi.nextBatch();
      if (batch.images.length === 0 && !allowEmpty) {
        // 全失败：配额 / 服务商问题
        const firstErr = batch.failures[0]?.error ?? '云端图片服务商无响应';
        if (firstErr.includes('quota') || firstErr.includes('配额')) {
          setPhase({ kind: 'quota-exhausted', reason: firstErr });
        } else {
          setPhase({ kind: 'image-failed', reason: firstErr });
        }
        return null;
      }
      return batch;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPhase({ kind: 'network-down', reason: msg });
      return null;
    }
  }, []);

  // 进入立即出图
  useEffect(() => {
    let mounted = true;
    (async () => {
      const batch = await loadBatch();
      if (!mounted || !batch) return;
      setPhase({ kind: 'showing', batch, index: 0 });
    })();
    return () => {
      mounted = false;
    };
  }, [loadBatch]);

  const currentImage: BatchImage | undefined =
    phase.kind === 'showing' ? phase.batch.images[phase.index] : undefined;

  const advance = useCallback(
    async (signal: 1 | -1) => {
      if (phase.kind !== 'showing') return;
      const img = phase.batch.images[phase.index];
      if (!img) return;
      setTodaySwiped((n) => n + 1);
      if (signal === 1) setTodayLiked((n) => n + 1);

      etsyForgeApi.signal(img.id, signal).catch(() => {
        // 信号写失败不阻塞用户；下一张照样刷
      });

      const nextIndex = phase.index + 1;

      // 预生成下一批
      if (nextIndex >= PREFETCH_AT_INDEX && !prefetchingRef.current && !nextBatch) {
        prefetchingRef.current = true;
        loadBatch(true).then((b) => {
          if (b && b.images.length > 0) setNextBatch(b);
          prefetchingRef.current = false;
        });
      }

      if (nextIndex < phase.batch.images.length) {
        setPhase({ kind: 'showing', batch: phase.batch, index: nextIndex });
        return;
      }

      // 这批刷完了，切换到下一批（如果已预生成好）
      if (nextBatch) {
        setPhase({ kind: 'showing', batch: nextBatch, index: 0 });
        setNextBatch(null);
        return;
      }

      // 没预生成完：进入等待态，再触发一次加载
      setPhase({ kind: 'batch-done' });
      const b = await loadBatch();
      if (!b) return;
      setPhase({ kind: 'showing', batch: b, index: 0 });
    },
    [phase, nextBatch, loadBatch],
  );

  // 键盘 ← / →
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        void advance(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        void advance(1);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advance]);

  // 触摸滑动
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      void advance(dx > 0 ? 1 : -1);
    }
  };

  return (
    <div
      className="flex h-screen w-full flex-col bg-zinc-950 text-zinc-100"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <TopBar liked={todayLiked} swiped={todaySwiped} />
      <main className="flex flex-1 items-center justify-center overflow-hidden px-6 py-4">
        <PhaseRenderer phase={phase} currentImage={currentImage} onRetry={() => loadBatch().then((b) => b && setPhase({ kind: 'showing', batch: b, index: 0 }))} />
      </main>
      {phase.kind === 'showing' && (
        <BottomActions onSkip={() => void advance(-1)} onLike={() => void advance(1)} />
      )}
    </div>
  );
}

function TopBar({ liked, swiped }: { liked: number; swiped: number }) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-3 text-xs text-zinc-400">
      <span>今日已刷 {swiped} · 收藏 {liked}</span>
      <Link
        href="/apps/etsy-forge/library"
        className="rounded-md border border-zinc-700 px-3 py-1 text-zinc-200 hover:bg-zinc-900"
      >
        我的图库
      </Link>
    </div>
  );
}

function PhaseRenderer({
  phase,
  currentImage,
  onRetry,
}: {
  phase: AppPhase;
  currentImage?: BatchImage;
  onRetry: () => void;
}) {
  if (phase.kind === 'loading') return <Status text="AI 正在挑灵感…" />;
  if (phase.kind === 'batch-done') return <Status text="下一批正在路上…" />;
  if (phase.kind === 'network-down') {
    return <Failure title="网络好像断了" detail={phase.reason} onRetry={onRetry} />;
  }
  if (phase.kind === 'image-failed') {
    return <Failure title="这张出炸了，跳过" detail={phase.reason} onRetry={onRetry} />;
  }
  if (phase.kind === 'quota-exhausted') {
    return (
      <div className="max-w-md text-center">
        <p className="mb-3 text-lg font-medium text-zinc-100">配额不足</p>
        <p className="mb-6 text-sm text-zinc-400">{phase.reason}</p>
        <a
          href="https://lumos.miki.zj.cn/account/billing"
          target="_blank"
          rel="noreferrer"
          className="inline-block rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900"
        >
          去 Lumos 充值
        </a>
      </div>
    );
  }
  if (phase.kind === 'showing' && currentImage) {
    return (
      <div className="flex h-full max-h-[80vh] w-full max-w-2xl items-center justify-center">
        <img
          src={currentImage.url}
          alt={currentImage.theme}
          className="max-h-full max-w-full rounded-lg object-contain ring-1 ring-zinc-800"
          draggable={false}
        />
      </div>
    );
  }
  return null;
}

function BottomActions({ onSkip, onLike }: { onSkip: () => void; onLike: () => void }) {
  return (
    <div className="flex items-center justify-center gap-8 border-t border-zinc-800 px-6 py-5">
      <button
        type="button"
        onClick={onSkip}
        className="flex h-14 w-14 items-center justify-center rounded-full border border-zinc-700 text-2xl text-zinc-300 hover:bg-zinc-900"
        aria-label="跳过"
        title="跳过 (← 或左滑)"
      >
        👎
      </button>
      <button
        type="button"
        onClick={onLike}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 text-2xl text-zinc-900 hover:bg-white"
        aria-label="收藏到图库"
        title="收藏 (→ 或右滑)"
      >
        👍
      </button>
    </div>
  );
}

function Status({ text }: { text: string }) {
  return <p className="text-sm text-zinc-400">{text}</p>;
}

function Failure({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail: string;
  onRetry: () => void;
}) {
  return (
    <div className="max-w-md text-center">
      <p className="mb-2 text-base text-zinc-100">{title}</p>
      <p className="mb-5 break-words text-xs text-zinc-500">{detail}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
      >
        重试
      </button>
    </div>
  );
}
