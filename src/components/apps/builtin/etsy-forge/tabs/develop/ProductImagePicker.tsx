'use client';

// 从「我的产品」挑一张产品图新建 listing(用户反馈：要选的是「那张产品图」，不是整组)。
// 按产品分组只为给上下文，点其中一张图 → 用它新建(预填主图 + 它的印花)。
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { etsyForgeApi, type MockupItem } from '../../api-client';

interface Group {
  productId: string;
  title: string;
  items: MockupItem[];
}

function buildGroups(mockups: MockupItem[]): Group[] {
  const map = new Map<string, Group>();
  for (const m of mockups) {
    if (m.status !== 'success' || !m.url) continue;
    const pid = m.source_product_id || m.source_product_title || '其他';
    const g = map.get(pid) ?? { productId: pid, title: m.source_product_title || '未命名产品', items: [] };
    g.items.push(m);
    map.set(pid, g);
  }
  return [...map.values()].filter((g) => g.items.length > 0).sort((a, b) => b.items.length - a.items.length);
}

export function ProductImagePicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (mockupId: string, title: string) => void }) {
  const [mockups, setMockups] = useState<MockupItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void (async () => {
      try {
        const m = await etsyForgeApi.listMockups();
        setMockups(m.mockups);
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  const groups = useMemo(() => buildGroups(mockups), [mockups]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>挑一张产品图，开发成 listing</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">点你想上架的那张产品图。新 listing 会预填它为主图、它用的印花为细节图；其余图位你再自己挑。</p>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          {loading ? (
            <p className="p-8 text-center text-sm text-muted-foreground">加载中…</p>
          ) : groups.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">还没有产品图。先去「我的产品」生成。</p>
          ) : (
            groups.map((g) => (
              <section key={g.productId}>
                <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">{g.title} · {g.items.length} 张</h4>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                  {g.items.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        onPick(m.id, g.title);
                        onClose();
                      }}
                      className="overflow-hidden rounded border hover:ring-2 hover:ring-foreground"
                      title="用这张图新建 listing"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.url as string} alt="" className="aspect-square w-full object-cover" />
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
