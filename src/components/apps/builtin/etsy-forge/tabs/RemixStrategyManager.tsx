'use client';

// 二创方向矩阵策略管理(动态):列出 A/B/C/D 等策略,可改 名称/说明/保留改变文案/是否喂参考图/是否高相似/默认/启用,可增可删。
// 一键出品、图库二创 的方向选择都读这里;首次自动播种 4 条。改完即存(失焦保存)。

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { etsyForgeApi, type RemixStrategy } from '../api-client';

export function RemixStrategyManager() {
  const [rows, setRows] = useState<RemixStrategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState<Set<string>>(new Set()); // 哪些方向展开了「出图文案」大编辑框
  const toggleProfile = (id: string) =>
    setProfileOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows((await etsyForgeApi.listStrategies()).strategies);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (open && rows.length === 0) void load();
  }, [open, rows.length, load]);

  const patch = (id: string, p: Partial<RemixStrategy>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const save = (id: string, p: Partial<RemixStrategy>) => void etsyForgeApi.updateStrategy(id, p).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  const add = async () => {
    try {
      await etsyForgeApi.createStrategy({ code: `X${rows.length + 1}`, label: '新方向', hint: '', profile: '', use_reference: true });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const del = async (id: string) => {
    if (!confirm('删除这个二创方向？(一键出品/图库二创将不再可选)')) return;
    await etsyForgeApi.deleteStrategy(id).catch(() => {});
    await load();
  };
  const reset = async () => {
    if (!confirm('恢复默认会删除当前所有方向(含你自定义的),重置成内置默认。确定?')) return;
    try {
      await Promise.all(rows.map((r) => etsyForgeApi.deleteStrategy(r.id)));
      await load(); // 库清空后 GET 会自动播种最新默认
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const flag = (on: boolean) => `rounded border px-1.5 py-0.5 ${on ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'}`;

  return (
    <section className="rounded-lg border bg-card p-5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <span>
          <span className="text-sm font-medium">二创方向矩阵</span>
          <span className="ml-2 text-xs text-muted-foreground">一键出品/图库二创的 A/B/C/D 方向；可改/加/删 {open ? '▾' : '▸'}</span>
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {error && <p className="rounded bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
          {loading ? (
            <p className="text-xs text-muted-foreground">加载中…</p>
          ) : (
            rows.map((d) => (
              <div key={d.id} className="space-y-2 rounded border p-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <input value={d.code} onChange={(e) => patch(d.id, { code: e.target.value })} onBlur={(e) => save(d.id, { code: e.target.value.trim() })} className="w-12 rounded border border-input bg-background px-1.5 py-1 text-center font-medium" title="编码" />
                  <input value={d.label} onChange={(e) => patch(d.id, { label: e.target.value })} onBlur={(e) => save(d.id, { label: e.target.value })} placeholder="方向名" className="w-28 rounded border border-input bg-background px-1.5 py-1" />
                  <input value={d.hint} onChange={(e) => patch(d.id, { hint: e.target.value })} onBlur={(e) => save(d.id, { hint: e.target.value })} placeholder="一句话说明(给你自己看的)" className="flex-1 rounded border border-input bg-background px-1.5 py-1 text-muted-foreground" />
                  <button type="button" onClick={() => void del(d.id)} className="shrink-0 px-1 text-destructive hover:underline">删</button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button type="button" className={flag(d.use_reference)} onClick={() => { patch(d.id, { use_reference: !d.use_reference }); save(d.id, { use_reference: !d.use_reference }); }} title="贴近原图的方向勾上,会把原印花喂给模型当参考">喂参考图</button>
                  <button type="button" className={flag(d.high_similarity)} onClick={() => { patch(d.id, { high_similarity: !d.high_similarity }); save(d.id, { high_similarity: !d.high_similarity }); }} title="高相似策略:非自有图会自动跳过(红线)">高相似</button>
                  <button type="button" className={flag(d.is_default)} onClick={() => { patch(d.id, { is_default: !d.is_default }); save(d.id, { is_default: !d.is_default }); }} title="没选方向时默认用它">默认</button>
                  <button type="button" className={flag(d.enabled)} onClick={() => { patch(d.id, { enabled: !d.enabled }); save(d.id, { enabled: !d.enabled }); }} title="停用则不在菜单出现">{d.enabled ? '启用' : '停用'}</button>
                  <div className="flex-1" />
                  <button type="button" onClick={() => toggleProfile(d.id)} className="text-sky-600 hover:underline">
                    {profileOpen.has(d.id) ? '收起出图文案 ▴' : '编辑出图文案 ▾'}
                  </button>
                </div>
                {profileOpen.has(d.id) && (
                  <div>
                    <p className="mb-1 text-[10px] text-muted-foreground">出图文案(英文,注入 prompt 的「保留什么/改变什么/相似度目标」)：</p>
                    <textarea
                      value={d.profile}
                      onChange={(e) => patch(d.id, { profile: e.target.value })}
                      onBlur={(e) => save(d.id, { profile: e.target.value })}
                      rows={8}
                      placeholder="例如:Keep the same visual style... change motif/subject... Similarity targets — content: low · ..."
                      className="w-full resize-y rounded border border-input bg-background p-2 font-mono text-[11px] leading-relaxed"
                    />
                  </div>
                )}
              </div>
            ))
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void add()}>＋ 新增方向</Button>
            <button type="button" onClick={() => void reset()} className="text-[11px] text-muted-foreground hover:text-foreground hover:underline">恢复默认</button>
          </div>
        </div>
      )}
    </section>
  );
}
