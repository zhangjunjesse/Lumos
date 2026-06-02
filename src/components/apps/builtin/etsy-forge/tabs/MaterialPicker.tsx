'use client';

// 创作区「选参考图」弹层：从素材库(印花/场景/模特/产品/姿势)挑图，点一张就派发全局
// `attach-file-to-chat` 事件 → ChatView 的 FileTreeAttachmentBridge 按本地路径把它加进输入框附件。
// 可连续多选，完成关闭。复用现有事件机制，不改 ChatView。

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { etsyForgeApi, type AssetItem } from '../api-client';

const CAT_LABEL: Record<AssetItem['category'], string> = {
  design: '印花',
  scene: '场景',
  model: '模特',
  product: '产品',
  pose: '姿势',
  remix: '二创',
};

export function MaterialPicker({ onClose }: { onClose: () => void }) {
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void etsyForgeApi
      .listAssets()
      .then((r) => setAssets(r.assets.filter((a) => a.status === 'success' && a.path && a.url)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const pick = (a: AssetItem) => {
    if (!a.path) return;
    window.dispatchEvent(new CustomEvent('attach-image-ref-to-chat', { detail: { path: a.path, label: CAT_LABEL[a.category] } }));
    setAdded((s) => new Set(s).add(a.id));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-lg border bg-card p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-sm font-medium">从素材库选参考图</h3>
          <span className="text-xs text-muted-foreground">点图加入输入框，可多选</span>
          <div className="flex-1" />
          <Button size="sm" onClick={onClose}>
            完成
          </Button>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">加载中…</p>
        ) : assets.length === 0 ? (
          <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            素材库还没有可用的图。去「我关注的商品」抠印花 / 生成素材。
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
            {assets.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => pick(a)}
                title="加入参考图"
                className={`relative overflow-hidden rounded border ${added.has(a.id) ? 'ring-2 ring-foreground' : 'hover:ring-1 hover:ring-foreground'}`}
              >
                <span className="absolute left-1 top-1 z-10 rounded bg-black/60 px-1 text-[9px] text-white">
                  {CAT_LABEL[a.category]}
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.url as string} alt={CAT_LABEL[a.category]} className="aspect-square w-full object-cover" />
                {added.has(a.id) && (
                  <span className="absolute right-1 top-1 z-10 rounded bg-foreground px-1 text-[9px] text-background">
                    ✓ 已加
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
