'use client';

// 选图器(R1)：只列用户自有生成图 —— 产品图(mockups) + 自有素材(scene/model/product/remix)。
// 同行图、同行印花/模特抠图(design/pose)、采集详情图一律不列，并明示原因(DMCA)。
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { etsyForgeApi } from '../../api-client';
import { extractCreationImages } from '../creation-images';
import type { Message } from '@/types';
import type { ListingPhoto, PhotoSourceType } from '@/lib/etsy-forge/listing/types';

const CREATION_SESSION_KEY = 'lumos:etsy-creation-session';

// 可作 listing 图的自有素材类(排除 design=同行印花抠图、pose=同行模特抠图)。
const OWN_ASSET_CATEGORIES = new Set(['scene', 'model', 'product', 'remix']);

// 读创作助手会话里生成的图(回流到这里)。会话是全局单例(localStorage 缓存 id)。
async function loadCreationImages(): Promise<{ src: string }[]> {
  try {
    const id = typeof window !== 'undefined' ? localStorage.getItem(CREATION_SESSION_KEY) : null;
    if (!id) return [];
    const res = await fetch(`/api/chat/sessions/${id}/messages?limit=100`);
    if (!res.ok) return [];
    const data = (await res.json()) as { messages?: Message[] };
    return extractCreationImages(data.messages || []).map((i) => ({ src: i.url }));
  } catch {
    return [];
  }
}

export type PickedPhoto = Pick<ListingPhoto, 'src' | 'sourceType' | 'sourceId'>;

interface Img {
  src: string;
  sourceType: PhotoSourceType;
  sourceId: string;
  label: string;
}

export function PhotoPicker({ open, roleLabel, onClose, onPick }: { open: boolean; roleLabel: string; onClose: () => void; onPick: (p: PickedPhoto) => void }) {
  const [imgs, setImgs] = useState<Img[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void (async () => {
      try {
        const [m, a] = await Promise.all([etsyForgeApi.listMockups(), etsyForgeApi.listAssets()]);
        const out: Img[] = [];
        // 创作助手出的图(回流):放最前,方便把刚在创作助手做的图加进来。
        for (const im of await loadCreationImages()) out.push({ src: im.src, sourceType: 'generated', sourceId: '', label: '创作助手' });
        for (const x of m.mockups) if (x.status === 'success' && x.url) out.push({ src: x.url, sourceType: 'mockup', sourceId: x.id, label: '产品图' });
        for (const x of a.assets) if (x.status === 'success' && x.url && OWN_ASSET_CATEGORIES.has(x.category)) out.push({ src: x.url, sourceType: 'asset', sourceId: x.id, label: x.category });
        setImgs(out);
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>挑一张图放入「{roleLabel}」</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          列出你的原创生成图 + 创作助手出的图(放最前)。采集来的同行图、同行印花/模特抠图不能作自己 listing 图（DMCA 侵权），故不在此列出。
        </p>
        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <p className="p-8 text-center text-sm text-muted-foreground">加载中…</p>
          ) : imgs.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">还没有自有生成图。先去「我的产品 / 我的图库」生成。</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {imgs.map((im, i) => (
                <button
                  key={`${im.sourceId}-${i}`}
                  type="button"
                  onClick={() => {
                    onPick({ src: im.src, sourceType: im.sourceType, sourceId: im.sourceId });
                    onClose();
                  }}
                  className="group relative overflow-hidden rounded border hover:ring-2 hover:ring-foreground"
                  title={im.label}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={im.src} alt={im.label} className="aspect-square w-full object-cover" />
                  <span className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 py-0.5 text-[10px] text-white">{im.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
