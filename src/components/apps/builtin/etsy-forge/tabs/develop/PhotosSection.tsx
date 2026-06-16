'use client';

// 图片子 tab = 选素材批量出商品图 + 逐张精修。
// 顶部印花种子；中间「选图库素材(模特1/场景多/姿势多/颜色多)→批量出图」；下面商品图结果库(精修/设主图/删/挑/传)。
// 生成异步:发起后轮询 photo-jobs，running 显示转圈占位，success 追加进图库，failed 提示。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { LISTING_LIMITS, type ListingPhoto } from '@/lib/etsy-forge/listing/types';
import type { Message } from '@/types';
import { etsyForgeApi, type AssetItem } from '../../api-client';
import { extractCreationImages } from '../creation-images';
import { listingApi } from './listing-api';
import { MaterialStudio, type BatchSel } from './MaterialStudio';
import { type BaseMaterial } from './MaterialPickerGrid';
import { PhotoGallery } from './PhotoGallery';
import { PhotoRefineDialog } from './PhotoRefineDialog';
import { PhotoPicker, type PickedPhoto } from './PhotoPicker';
import type { SectionProps } from './use-listing-editor';

const CAT_LABEL: Record<string, string> = { scene: '场景', model: '模特', product: '空白产品图', pose: '姿势', remix: '二创印花', design: '印花' };

type Dirs = { modelDescs: string[]; sceneDescs: string[]; poseDescs: string[]; productDescs: string[] };
// 把本批实际用到的方向拼成一句给用户看(读到没/用了什么,不再黑箱)。
function dirSummary(d: Dirs): string {
  const parts: string[] = [];
  if (d.sceneDescs.length) parts.push(`场景=${d.sceneDescs.join(' / ')}`);
  if (d.modelDescs.length) parts.push(`模特=${d.modelDescs.join(' / ')}`);
  if (d.poseDescs.length) parts.push(`姿势=${d.poseDescs.join(' / ')}`);
  if (d.productDescs.length) parts.push(`商品氛围=${d.productDescs.join(' / ')}`);
  return parts.length ? parts.join(' · ') : '未读到任何方向 → 用了内置默认池(可能没配识图服务商，或素材没描述)';
}
type NewPhoto = { src: string; sourceType: ListingPhoto['sourceType']; label?: string; role?: ListingPhoto['role'] };

export function PhotosSection({ listing, patch }: SectionProps) {
  const photos = useMemo(() => listing.photos || [], [listing.photos]);
  const photosRef = useRef(photos);
  photosRef.current = photos;

  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [collectedProducts, setCollectedProducts] = useState<BaseMaterial[]>([]); // 已采集商品(主图)
  const [followedProducts, setFollowedProducts] = useState<BaseMaterial[]>([]); // 我关注的商品(详情图)
  const [runningCount, setRunningCount] = useState(0);
  const [pending, setPending] = useState(0); // 乐观占位:点生成后立刻显示,不等后端读图返回
  const [genErr, setGenErr] = useState<string | null>(null);
  const [lastDirs, setLastDirs] = useState<Dirs | null>(null);
  const [creationImgs, setCreationImgs] = useState<string[]>([]); // 创作助手出的图(回流)
  const [pickFor, setPickFor] = useState<'design' | 'gallery' | null>(null);
  const [refineSrc, setRefineSrc] = useState<string | null>(null);
  const consumed = useRef<Set<string>>(new Set());
  const tickRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    void etsyForgeApi.listAssets().then((r) => setAssets(r.assets)).catch(() => {});
    // 已采集商品(主图):各取一张主图,按 url 去重。
    void etsyForgeApi.listProducts().then((r) => {
      const seen = new Set<string>();
      const out: BaseMaterial[] = [];
      for (const p of r.products) if (p.main_image_url && !seen.has(p.main_image_url)) { seen.add(p.main_image_url); out.push({ src: p.main_image_url, label: p.title || '采集商品' }); }
      setCollectedProducts(out.slice(0, 150));
    }).catch(() => {});
    // 我关注的商品(详情图):展开,按 url 去重(模板图常重复,撞 key 会选不动)。
    void etsyForgeApi.listLibrary().then((r) => {
      const seen = new Set<string>();
      const out: BaseMaterial[] = [];
      for (const p of r.products) for (const im of p.images) if (im.url && !seen.has(im.url)) { seen.add(im.url); out.push({ src: im.url, label: p.title || '关注商品' }); }
      setFollowedProducts(out.slice(0, 150));
    }).catch(() => {});
  }, []);

  // 创作助手出的图(回流):轮询会话生成图,有未加入图库的就提示一键加入。
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const id = localStorage.getItem('lumos:etsy-creation-session');
        if (!id) return;
        const res = await fetch(`/api/chat/sessions/${id}/messages?limit=100`);
        if (!res.ok) return;
        const data = (await res.json()) as { messages?: Message[] };
        if (!stop) setCreationImgs(extractCreationImages(data.messages ?? []).map((i) => i.url));
      } catch {
        /* 忽略一轮 */
      }
    };
    void load();
    const t = setInterval(() => { if (!stop) void load(); }, 8000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  const materialsByCat = useMemo(() => {
    const m: Record<string, BaseMaterial[]> = {};
    for (const a of assets) {
      if (a.status !== 'success' || !a.url) continue;
      (m[a.category] ??= []).push({ src: a.url, label: a.source_product_title || CAT_LABEL[a.category] || '素材' });
    }
    return m;
  }, [assets]);

  const append = useCallback((items: NewPhoto[]) => {
    let next = photosRef.current;
    for (const it of items) next = [...next, { position: next.length, src: it.src, sourceType: it.sourceType, label: it.label, role: it.role, isMain: next.length === 0 }];
    patch({ photos: next });
  }, [patch]);

  // 创作助手出的、还没加进图库的图(回流提示用)。
  const newCreation = useMemo(() => creationImgs.filter((u) => !photos.some((p) => p.src === u)), [creationImgs, photos]);

  // 轮询生成任务:running→占位转圈数；success→追加进图库；failed→提示。
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const { jobs } = await listingApi.listPhotoJobs(listing.id);
        let run = 0;
        const adds: NewPhoto[] = [];
        for (const j of jobs) {
          if (j.status === 'running') { run++; continue; }
          if (consumed.current.has(j.id)) continue;
          consumed.current.add(j.id);
          if (j.status === 'success' && j.result_src) adds.push({ src: j.result_src, sourceType: 'generated', role: j.role });
          else if (j.status === 'failed') setGenErr(`${j.label}：${j.error || '生成失败'}`);
          void listingApi.deletePhotoJob(j.id).catch(() => {});
        }
        if (adds.length) append(adds);
        if (!stop) setRunningCount(run);
      } catch {
        /* 忽略一轮 */
      }
    };
    tickRef.current = tick;
    void tick();
    const t = setInterval(() => { if (!stop) void tick(); }, 4000);
    return () => { stop = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing.id]);

  const onBatch = (sel: BatchSel) => {
    setGenErr(null);
    // 乐观占位:点了立刻按预计张数显示「生成中」,不等后端读图。读图+起任务完成后由轮询接管,再清掉乐观值。
    const n = (sel.outputs.model ? sel.modelCount : 0) + (sel.outputs.scene ? 2 : 0) + (sel.outputs.detail ? 1 : 0) + (sel.outputs.flat ? 1 : 0);
    setPending(n);
    listingApi.generateBatch(listing.id, sel)
      .then((r) => { setLastDirs(r.dirs); return tickRef.current(); })
      .then(() => setPending(0))
      .catch((e) => { setPending(0); setGenErr(e instanceof Error ? e.message : String(e)); });
  };
  const doRefine = (src: string, instruction: string) => {
    setGenErr(null);
    listingApi.refinePhoto(listing.id, src, instruction)
      .then(() => { setRunningCount((c) => c + 1); return tickRef.current(); })
      .catch((e) => setGenErr(e instanceof Error ? e.message : String(e)));
  };
  const onPicked = (p: PickedPhoto) => {
    if (pickFor === 'design') patch({ design_src: p.src });
    else if (pickFor === 'gallery') append([{ src: p.src, sourceType: p.sourceType }]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3">
        {listing.design_src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={listing.design_src} alt="印花" className="size-14 rounded border object-cover" />
        ) : (
          <div className="flex size-14 items-center justify-center rounded border border-dashed text-center text-[10px] text-muted-foreground">未设印花</div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">印花（生成种子）</p>
          <p className="text-xs text-muted-foreground">批量出图都会把这个印花合成到选中的素材上。</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setPickFor('design')}>{listing.design_src ? '换印花' : '设印花'}</Button>
      </div>

      <MaterialStudio materialsByCat={materialsByCat} collectedProducts={collectedProducts} followedProducts={followedProducts} generating={runningCount > 0} onGenerate={onBatch} />

      <div>
        <p className="text-sm text-muted-foreground">商品图 · {photos.length} 张{photos.length >= LISTING_LIMITS.PHOTOS ? `（Etsy 上限 ${LISTING_LIMITS.PHOTOS}，多的不会上传）` : ''} · 点 ★ 设主图</p>
        {genErr && <p className="mt-1 text-xs text-destructive">{genErr}</p>}
        {lastDirs && <p className="mt-1 text-xs text-muted-foreground">本批方向 — {dirSummary(lastDirs)}</p>}
        {newCreation.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-xs">
            <span>创作助手出了 {newCreation.length} 张新图</span>
            <button type="button" onClick={() => append(newCreation.map((u) => ({ src: u, sourceType: 'generated' as const })))} className="rounded border bg-background px-2 py-0.5 hover:bg-muted">全部加入</button>
            <button type="button" onClick={() => setPickFor('gallery')} className="text-muted-foreground underline hover:text-foreground">去挑</button>
          </div>
        )}
        <div className="mt-2">
          <PhotoGallery
            photos={photos}
            runningCount={Math.max(pending, runningCount)}
            onRefine={(src) => setRefineSrc(src)}
            onSetMain={(src) => patch({ photos: photos.map((p) => ({ ...p, isMain: p.src === src })) })}
            onRemove={(src) => patch({ photos: photos.filter((p) => p.src !== src) })}
            onPick={() => setPickFor('gallery')}
            onUpload={(src) => append([{ src, sourceType: 'upload' }])}
          />
        </div>
      </div>

      <div className="max-w-md">
        <label className="text-xs font-medium">视频（可选，本地路径或链接）</label>
        <input value={listing.video_src ?? ''} onChange={(e) => patch({ video_src: e.target.value })} placeholder="/api/media/serve?path=… 或 https://…" className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm" />
      </div>

      <PhotoPicker open={pickFor !== null} roleLabel={pickFor === 'design' ? '印花' : '商品图'} onClose={() => setPickFor(null)} onPick={onPicked} />
      <PhotoRefineDialog open={refineSrc !== null} src={refineSrc} onClose={() => setRefineSrc(null)} onRefine={(ins) => { if (refineSrc) doRefine(refineSrc, ins); }} />
    </div>
  );
}
