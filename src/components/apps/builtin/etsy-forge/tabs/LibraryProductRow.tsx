'use client';

// 图库里的一个商品行：左侧商品信息（价格/评分/销量/收藏/标签/链接），右侧该商品的详情图缩略图。
// 销量/收藏来自 EHunt，抓不到如实显示「无 EHunt」，不编数字。
// 选择模式下：商品行可勾选、点图=选中图（平时点图=放大）；用于批量打标签/删除。

import { useState } from 'react';
import type { ImageType, LibProduct } from '../api-client';
import { QuickAddChat } from './QuickAddChat';

const TYPE_LABEL: Record<ImageType, string> = { model_scene: '商品', product: '产品', size: '尺码', color: '颜色', other: '其他' };
const TYPE_CYCLE: ImageType[] = ['model_scene', 'product', 'size', 'color', 'other'];

export function LibraryProductRow({
  product: p,
  selectMode,
  productSelected,
  onToggleProduct,
  selectedImageIds,
  onToggleImage,
  onOpenImage,
  onViewReviews,
  onViewCutouts,
  onClassify,
  onSetImageType,
}: {
  product: LibProduct;
  selectMode: boolean;
  productSelected: boolean;
  onToggleProduct: () => void;
  selectedImageIds: Set<string>;
  onToggleImage: (id: string) => void;
  onOpenImage: (index: number) => void;
  onViewReviews: () => void;
  onViewCutouts: () => void;
  onClassify: () => void;
  onSetImageType: (imageId: string, type: ImageType) => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    if (!p.url) return;
    try {
      await navigator.clipboard.writeText(p.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard 不可用时静默 */
    }
  };

  return (
    <div
      className={`flex flex-col gap-3 rounded-lg border bg-card p-3 md:flex-row ${
        selectMode && productSelected ? 'border-foreground ring-1 ring-foreground' : ''
      }`}
    >
      <div className="w-full shrink-0 md:w-48">
        <div className="group flex items-start gap-1.5">
          {selectMode && (
            <input
              type="checkbox"
              checked={productSelected}
              onChange={onToggleProduct}
              title="选中此商品（批量打标签/删除）"
              className="mt-0.5 size-4 shrink-0 accent-foreground"
            />
          )}
          <p className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">
            {p.title || '(无标题)'}
          </p>
          {p.title && <QuickAddChat text={p.title} refLabel="商品标题" className="mt-0.5 shrink-0" label="标题加到创作助手" />}
        </div>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          入库 {p.latest_at ? new Date(p.latest_at).toLocaleString() : '—'}
        </p>
        <div className="mt-1.5 text-base font-semibold text-foreground">{p.price?.trim() ? p.price : '—'}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
          <span className={p.rating ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>
            {p.rating ? `★${p.rating}${p.reviews ? `(${p.reviews})` : ''}` : '★ —'}
          </span>
          <span className="text-muted-foreground">
            销 {p.sales != null ? `${p.sales}${p.sales_recent != null ? `(${p.sales_recent})` : ''}` : '—'}
          </span>
          <span className="text-muted-foreground">藏 {p.favorites != null ? p.favorites : '—'}</span>
        </div>
        {p.tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {p.tags.map((t) => (
              <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
          <a
            href={p.url || undefined}
            target="_blank"
            rel="noreferrer"
            className={`text-primary hover:underline ${p.url ? '' : 'pointer-events-none opacity-40'}`}
          >
            打开
          </a>
          <button
            type="button"
            onClick={() => void copyLink()}
            disabled={!p.url}
            className="text-primary hover:underline disabled:opacity-40"
          >
            {copied ? '已复制' : '复制链接'}
          </button>
          <button
            type="button"
            onClick={onViewReviews}
            className="text-primary hover:underline"
          >
            评论分析{p.review_count > 0 ? `（${p.review_count}）` : ''}
          </button>
          <button type="button" onClick={onClassify} title="AI 给详情图分类(商品图/产品图/尺码/颜色/其他)" className="text-primary hover:underline">
            分类图
          </button>
          {p.analyzed && (
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
              已分析
            </span>
          )}
          {/* 抠图状态互斥：抠图中 > 失败 > 已抠（重抠中不露旧的「查看抠图」） */}
          {p.cutout_status === 'running' ? (
            <span className="text-[10px] text-amber-600">抠图中…</span>
          ) : p.cutout_status === 'failed' ? (
            <button type="button" onClick={onViewCutouts} className="text-[10px] text-destructive hover:underline">
              抠图失败
            </button>
          ) : p.cutout_status === 'success' || p.cutout_status === 'partial' || p.cutout_count > 0 ? (
            <button
              type="button"
              onClick={onViewCutouts}
              className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-600 hover:underline dark:text-sky-400"
            >
              查看抠图（{p.cutout_count}）
            </button>
          ) : null}
          {/* 素材分析状态（异步后台） */}
          {p.asset_status === 'running' ? (
            <span className="text-[10px] text-amber-600">素材分析中…</span>
          ) : p.asset_status === 'failed' ? (
            <span className="text-[10px] text-destructive">素材分析失败</span>
          ) : p.asset_status === 'success' || p.asset_status === 'partial' ? (
            <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-600 dark:text-violet-400">
              已生成素材
            </span>
          ) : null}
          {/* 抠模特姿势状态（异步后台） */}
          {p.pose_status === 'running' ? (
            <span className="text-[10px] text-amber-600">抠姿势中…</span>
          ) : p.pose_status === 'failed' ? (
            <span className="text-[10px] text-destructive">抠姿势失败</span>
          ) : p.pose_status === 'success' || p.pose_status === 'partial' ? (
            <span className="rounded bg-teal-500/10 px-1.5 py-0.5 text-[10px] text-teal-600 dark:text-teal-400">
              已抠姿势
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-1 flex-wrap content-start gap-2">
        {p.images.map((img, i) => {
          const picked = selectMode && selectedImageIds.has(img.id);
          return (
            <div key={img.id} className="group relative size-20">
              <button
                type="button"
                onClick={() => (selectMode ? onToggleImage(img.id) : onOpenImage(i))}
                title={selectMode ? '点击选中/取消此图' : '点击放大'}
                className={`relative block size-20 overflow-hidden rounded border hover:ring-1 hover:ring-foreground ${
                  picked ? 'border-foreground ring-2 ring-foreground' : 'border-border'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={p.title} className="h-full w-full object-cover" />
                {img.is_main && (
                  <span className="absolute left-0.5 top-0.5 rounded bg-black/60 px-1 text-[9px] text-white">主</span>
                )}
                {selectMode && (
                  <span
                    className={`absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded text-[10px] ${
                      picked ? 'bg-foreground text-background' : 'bg-black/40 text-white'
                    }`}
                  >
                    {picked ? '✓' : ''}
                  </span>
                )}
              </button>
              <QuickAddChat path={img.path} refLabel="详情图" className="absolute bottom-0.5 right-0.5" label="图加到创作助手" />
              {img.image_type && (
                <button
                  type="button"
                  title="点击切换类型(人工纠正)"
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = TYPE_CYCLE[(TYPE_CYCLE.indexOf(img.image_type as ImageType) + 1) % TYPE_CYCLE.length];
                    onSetImageType(img.id, next);
                  }}
                  className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 text-[9px] text-white hover:bg-black/90"
                >
                  {TYPE_LABEL[img.image_type]}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

