'use client';

// 单张素材卡：素材图(点放大) + 来源(商品标题 + 原图缩略,点看原图) + 删除。
// 按类型视图显示来源(showSource);按来源视图已按商品分组,不重复显示来源。

import { useState } from 'react';
import type { AssetItem } from '../api-client';
import { QuickAddChat } from './QuickAddChat';

const CAT_LABEL: Record<AssetItem['category'], string> = { design: '印花', scene: '场景', model: '模特', product: '产品', pose: '姿势', remix: '二创' };

export function AssetCard({
  asset: a,
  showSource = true,
  onView,
  onViewOrig,
  onRemove,
  onRetry,
  onSeries,
  onRemix,
  onFission,
  fissioning,
}: {
  asset: AssetItem;
  showSource?: boolean;
  onView: (id: string) => void;
  onViewOrig: (url: string) => void;
  onRemove: (id: string) => void;
  onRetry?: (id: string) => Promise<void>;
  onSeries?: (asset: AssetItem) => void; // 系列化:二创/系列(达标) 扩展同系列
  onRemix?: (asset: AssetItem) => void; // 二创:基于这张印花出变体
  onFission?: (asset: AssetItem) => void; // 裂变:诊断→方向库→对比→定稿→迭代
  fissioning?: boolean; // 这张图正在裂变出图(后台跑) → 显示「裂变中」
}) {
  const [retrying, setRetrying] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const ok = a.status === 'success';
  // 「二创 ▾」下拉条目(以后加新动作往 actions 里 push 即可):
  //  裂变(印花/二创) → 方向库精修工作台;二创 → 基于印花出变体;二创/系列(达标) → 系列化。
  const actions: { label: string; cls?: string; run: () => void }[] = [];
  if (onFission && (a.category === 'design' || a.category === 'remix') && ok && a.source_product_id) actions.push({ label: '裂变', cls: 'text-violet-600', run: () => onFission(a) });
  if (onRemix && a.category === 'design' && ok && a.source_product_id) actions.push({ label: '二创', cls: 'text-sky-600', run: () => onRemix(a) });
  if (onSeries && a.category === 'remix' && ok && a.quality_flag !== 'weak' && a.source_product_id) actions.push({ label: '系列化', cls: 'text-sky-600', run: () => onSeries(a) });
  return (
    <div className={`group overflow-hidden rounded-md border ${fissioning ? 'ring-2 ring-violet-500' : ''}`}>
      <div className="relative">
        <span className="absolute left-1 top-1 z-10 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white">
          {CAT_LABEL[a.category]}
        </span>
        {fissioning && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 bg-violet-500/35">
            <span className="size-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            <span className="rounded bg-violet-600 px-1.5 py-0.5 text-[9px] font-medium text-white">裂变中…</span>
          </div>
        )}
        {a.quality_flag === 'weak' && (
          <span
            className="absolute left-1 top-6 z-10 rounded bg-amber-500/90 px-1.5 py-0.5 text-[9px] font-medium text-white"
            title={a.quality_note || '质检:有硬伤(白底框/多余文字/糊…)'}
          >
            弱
          </span>
        )}
        {a.series_of && (
          <span className="absolute left-1 top-6 z-10 rounded bg-sky-600/90 px-1.5 py-0.5 text-[9px] font-medium text-white" title="系列化衍生图">
            系列
          </span>
        )}
        {a.status === 'success' && a.url && a.path && (
          <QuickAddChat path={a.path} refLabel={CAT_LABEL[a.category]} className="absolute right-1 top-1" />
        )}
        {a.status === 'success' && a.url ? (
          <button type="button" onClick={() => onView(a.id)} title="点击放大" className="block w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.url} alt={CAT_LABEL[a.category]} className="aspect-square w-full object-cover" />
          </button>
        ) : (
          <div className="flex aspect-square w-full flex-col items-center justify-center gap-1.5 bg-destructive/5 p-2 text-center text-[10px] text-destructive">
            <span className="line-clamp-3">{a.failure_reason || '生成失败'}</span>
            {onRetry && a.category !== 'design' && (
              <button
                type="button"
                disabled={retrying}
                onClick={async () => {
                  setRetrying(true);
                  try {
                    await onRetry(a.id);
                  } finally {
                    setRetrying(false);
                  }
                }}
                className="rounded border border-destructive/40 px-2 py-0.5 text-[10px] hover:bg-destructive/10 disabled:opacity-50"
              >
                {retrying ? '重试中…' : '重试'}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="space-y-1 p-1.5">
        <div className="flex items-center justify-between gap-1">
          {showSource ? (
            <span className="line-clamp-1 text-[10px] text-muted-foreground" title={a.source_product_title ?? ''}>
              来自：{a.source_product_title || '—'}
            </span>
          ) : (
            <span />
          )}
          <div className="flex shrink-0 items-center gap-2">
            {actions.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  title="二创操作"
                  className="rounded border px-1 text-[10px] text-sky-600 hover:bg-muted"
                >
                  二创 ▾
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                    <div className="absolute bottom-full right-0 z-40 mb-1 min-w-[84px] rounded-md border bg-popover p-1 shadow-md">
                      {actions.map((act) => (
                        <button
                          key={act.label}
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            act.run();
                          }}
                          className={`block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted ${act.cls ?? ''}`}
                        >
                          {act.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {/* 印花在「查看抠图」里管删除,这里不放删;其它类删除按钮鼠标移上去才显示 */}
            {a.category !== 'design' && (
              <button
                type="button"
                onClick={() => onRemove(a.id)}
                className="text-[10px] text-destructive opacity-0 transition hover:underline group-hover:opacity-100"
              >
                删
              </button>
            )}
          </div>
        </div>
        {showSource && a.source_image_urls.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-muted-foreground">原图</span>
            {a.source_image_urls.map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => onViewOrig(u)}
                title="看原图"
                className="size-8 shrink-0 overflow-hidden rounded border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="原图" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
