'use client';

// 灵感：自动归集创作会话产出的生成图，按创建时间(message.created_at)分组、每小时一组。
// 生成图有两种落地：①assistant 文本里的 ```image-gen-result``` 代码块(localPath)
//                  ②generate_image 工具结果 block(path/url)。两种都扫，覆盖所有情况。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { type Message } from '@/types';
import { etsyForgeApi } from '../api-client';
import { extractCreationImages, type CreationImage } from './creation-images';
import { ImageLightbox } from './ImageLightbox';
import { QuickAddChat } from './QuickAddChat';
import { FissionPanel } from './FissionPanel';

type WhImage = CreationImage;

function hourLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '未知时间';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`;
}

// 按小时分组，保持原顺序(新在前)；items 带扁平 index 供 lightbox 跨组放大。
function groupByHour(images: WhImage[]): { label: string; items: { im: WhImage; idx: number }[] }[] {
  const groups: { label: string; items: { im: WhImage; idx: number }[] }[] = [];
  const map = new Map<string, number>();
  images.forEach((im, idx) => {
    const label = hourLabel(im.createdAt);
    let gi = map.get(label);
    if (gi === undefined) {
      gi = groups.length;
      map.set(label, gi);
      groups.push({ label, items: [] });
    }
    groups[gi].items.push({ im, idx });
  });
  return groups;
}

export function WarehouseView({ messages }: { messages: Message[] }) {
  const chatImages = useMemo(() => extractCreationImages(messages), [messages]);
  // 二创印花(assets/remix)也归集进灵感:存哪不变(SOP⑥仍从图库取),这里只是多读一个来源展示。
  const [remixImages, setRemixImages] = useState<WhImage[]>([]);
  const [fission, setFission] = useState<{ baseRef: string; baseTitle: string } | null>(null);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [fissioningUrls, setFissioningUrls] = useState<Set<string>>(new Set()); // 正在裂变的灵感图(base=url)
  const loadRemix = useCallback(async () => {
    try {
      const r = await etsyForgeApi.listAssets('remix');
      setRemixImages(
        r.assets
          .filter((a) => a.status === 'success' && a.url)
          .map((a) => ({ url: a.url as string, prompt: a.source_product_title ? `二创·${a.source_product_title}` : '二创', createdAt: a.created_at })),
      );
    } catch {
      /* 忽略 */
    }
  }, []);
  useEffect(() => {
    // loadRemix 内 await 后才 setState(异步、非同步级联)。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRemix();
  }, [messages, loadRemix]);

  // 每 6s 轮询裂变活跃运行 → 哪些灵感图(base=url)正在「裂变中」;有跑完就刷新,让新灵感图冒出来。
  useEffect(() => {
    const tick = async () => {
      try {
        const { runs } = await etsyForgeApi.listFissionRuns();
        const next = new Set(runs.map((r) => r.base_asset_id).filter(Boolean));
        setFissioningUrls((prev) => {
          if (prev.size > 0 && next.size < prev.size) void loadRemix();
          return next;
        });
      } catch {
        /* 忽略 */
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 6000);
    return () => clearInterval(t);
  }, [loadRemix]);
  // 合并后按时间倒序(新在前),再按小时分组。
  const images = useMemo(
    () => [...chatImages, ...remixImages].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [chatImages, remixImages],
  );
  const groups = useMemo(() => groupByHour(images), [images]);
  const [idx, setIdx] = useState(-1);

  if (images.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
        灵感库还是空的。去「创作助手」选参考图 + 说要求生成图，产出会自动归集到这里。
      </p>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-1">
      {groups.map((g) => (
        <section key={g.label} className="mb-5">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">
            {g.label} · {g.items.length} 张
          </h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7">
            {g.items.map(({ im, idx: flatIdx }) => {
              const fissioning = fissioningUrls.has(im.url);
              return (
              <div key={`${im.url}-${flatIdx}`} className={`group relative ${fissioning ? 'rounded ring-2 ring-violet-500' : ''}`}>
                <button
                  type="button"
                  onClick={() => setIdx(flatIdx)}
                  title={im.prompt || '放大'}
                  className="block w-full overflow-hidden rounded border hover:ring-1 hover:ring-foreground"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={im.url} alt="生成图" className="aspect-square w-full object-cover" />
                </button>
                {fissioning && (
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 rounded bg-violet-500/35">
                    <span className="size-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span className="rounded bg-violet-600 px-1.5 py-0.5 text-[9px] font-medium text-white">裂变中…</span>
                  </div>
                )}
                <QuickAddChat imageUrl={im.url} refLabel="二创图" className="absolute right-1 top-1" />
                <button
                  type="button"
                  onClick={() => setFission({ baseRef: im.url, baseTitle: im.prompt || '这张灵感图' })}
                  title="基于这张图裂变出新灵感(诊断→选方向→对比→定稿)"
                  className="absolute bottom-1 right-1 rounded border bg-card/90 px-1.5 py-0.5 text-[10px] text-violet-600 opacity-0 transition hover:bg-card group-hover:opacity-100"
                >
                  二创 ▾
                </button>
              </div>
              );
            })}
          </div>
        </section>
      ))}
      {idx >= 0 && (
        <ImageLightbox
          images={images.map((im) => ({ url: im.url, title: im.prompt }))}
          index={idx}
          onIndexChange={setIdx}
          onClose={() => setIdx(-1)}
        />
      )}
      {zoomUrl && <ImageLightbox images={[{ url: zoomUrl, title: '' }]} index={0} onIndexChange={() => {}} onClose={() => setZoomUrl(null)} />}
      {fission && (
        <FissionPanel
          productId="" /* 空 = 灵感目标:结果作为新灵感图回流,不归产品 */
          baseRef={fission.baseRef}
          baseAssetId={fission.baseRef} /* 灵感图无素材 id,用 url 作诊断缓存/状态键 */
          baseTitle={fission.baseTitle}
          onZoom={setZoomUrl}
          onClose={() => {
            setFission(null);
            void loadRemix(); // 裂变结果是 productless remix,回到灵感,刷新一下
          }}
        />
      )}
    </div>
  );
}
