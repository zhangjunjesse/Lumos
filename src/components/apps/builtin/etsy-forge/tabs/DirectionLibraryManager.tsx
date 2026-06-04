'use client';

// 裂变·方向库管理(动态):按轴分组列出全部方向,可改 名称/作用/出图片段/启用,可增、可删。
// 预置 35 个首次自动播种;之后完全由用户维护(对齐 playbook「库可演进、用户可增删改」)。改完即存(失焦保存)。

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { etsyForgeApi, type RemixDirection } from '../api-client';

export function DirectionLibraryManager() {
  const [rows, setRows] = useState<RemixDirection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { directions } = await etsyForgeApi.listDirections();
      setRows(directions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (open && rows.length === 0) void load();
  }, [open, rows.length, load]);

  const patchLocal = (id: string, p: Partial<RemixDirection>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const save = (id: string, p: Partial<RemixDirection>) => void etsyForgeApi.updateDirection(id, p).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  const add = async () => {
    try {
      await etsyForgeApi.createDirection({ axis: 'X', axis_name: '自定义', label: '新方向', hint: '', prompt_fragment: '' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const del = async (id: string) => {
    if (!confirm('删除这个方向？(诊断和裂变将不再用它)')) return;
    await etsyForgeApi.deleteDirection(id).catch(() => {});
    await load();
  };

  const byAxis = new Map<string, RemixDirection[]>();
  for (const r of rows) {
    const arr = byAxis.get(r.axis) ?? [];
    arr.push(r);
    byAxis.set(r.axis, arr);
  }

  return (
    <section className="rounded-lg border bg-card p-5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <span>
          <span className="text-sm font-medium">裂变 · 方向库</span>
          <span className="ml-2 text-xs text-muted-foreground">8 轴方向，诊断只能从这里选；可改/加/删 {open ? '▾' : '▸'}</span>
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {error && <p className="rounded bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
          {loading ? (
            <p className="text-xs text-muted-foreground">加载中…</p>
          ) : (
            [...byAxis.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([axis, items]) => (
                <div key={axis}>
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">{axis} · {items[0]?.axis_name}</p>
                  <div className="space-y-1.5">
                    {items.map((d) => (
                      <div key={d.id} className="flex items-start gap-2 rounded border p-1.5 text-xs">
                        <input type="checkbox" checked={d.enabled} onChange={(e) => { patchLocal(d.id, { enabled: e.target.checked }); save(d.id, { enabled: e.target.checked }); }} className="mt-1 size-3.5 accent-foreground" title="启用" />
                        <span className="mt-1 w-8 shrink-0 text-muted-foreground">{d.code}</span>
                        <div className="flex-1 space-y-1">
                          <input value={d.label} onChange={(e) => patchLocal(d.id, { label: e.target.value })} onBlur={(e) => save(d.id, { label: e.target.value })} placeholder="方向名" className="w-full rounded border border-input bg-background px-1.5 py-0.5" />
                          <input value={d.hint} onChange={(e) => patchLocal(d.id, { hint: e.target.value })} onBlur={(e) => save(d.id, { hint: e.target.value })} placeholder="作用(中文)" className="w-full rounded border border-input bg-background px-1.5 py-0.5 text-muted-foreground" />
                          <textarea value={d.prompt_fragment} onChange={(e) => patchLocal(d.id, { prompt_fragment: e.target.value })} onBlur={(e) => save(d.id, { prompt_fragment: e.target.value })} rows={2} placeholder="出图指令片段(英文)" className="w-full rounded border border-input bg-background px-1.5 py-0.5 font-mono text-[11px]" />
                        </div>
                        <button type="button" onClick={() => void del(d.id)} className="mt-1 shrink-0 text-destructive hover:underline">删</button>
                      </div>
                    ))}
                  </div>
                </div>
              ))
          )}
          <Button size="sm" variant="outline" onClick={() => void add()}>＋ 新增方向</Button>
        </div>
      )}
    </section>
  );
}
