'use client';

import * as React from 'react';
import { Loader2, Search, X } from 'lucide-react';

import { Input } from '@/components/ui/input';

interface Candidate {
  wxid: string;
  display: string;
  nickname: string;
  remark: string;
  has_remark: boolean;
}

/**
 * 成员选择器：搜**全量通讯录**（exporter resolve_contact），不是只搜近期
 * 会话——否则没有直聊的"刘总"根本选不到；且同名多人（实测 3 个「刘总」）
 * 必须显示备注/昵称/wxid 才能选对。规则只存 wxid（稳定）。
 */
export function SettingsGroupTagMemberPicker({
  selected,
  labels,
  onChange,
}: {
  selected: string[];
  /** wxid → 展示名缓存，仅 UI 用；规则本身只存 wxid。 */
  labels: Record<string, string>;
  onChange: (members: string[], labels: Record<string, string>) => void;
}): React.ReactElement {
  const [q, setQ] = React.useState('');
  const [items, setItems] = React.useState<Candidate[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const seq = React.useRef(0);

  React.useEffect(() => {
    const query = q.trim();
    if (!query) {
      setItems([]);
      setErr(null);
      return;
    }
    const mySeq = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/apps/builtin/wechat/group-tags/resolve-contact?q=${encodeURIComponent(query)}&limit=20`,
          { cache: 'no-store' },
        );
        const json = (await res.json().catch(() => ({}))) as {
          items?: Candidate[];
          message?: string;
          error?: string;
        };
        if (mySeq !== seq.current) return; // 丢弃过期响应
        if (!res.ok) throw new Error(json.message ?? json.error ?? '搜索失败');
        setItems(json.items ?? []);
        setErr(null);
      } catch (e) {
        if (mySeq !== seq.current) return;
        setErr(e instanceof Error ? e.message : '搜索失败');
        setItems([]);
      } finally {
        if (mySeq === seq.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  function add(c: Candidate): void {
    if (selected.includes(c.wxid)) return;
    onChange([...selected, c.wxid], { ...labels, [c.wxid]: c.remark || c.nickname || c.wxid });
  }
  function remove(wxid: string): void {
    onChange(selected.filter((w) => w !== wxid), labels);
  }

  return (
    <div className="space-y-2">
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {selected.map((w) => (
            <span key={w} className="flex items-center gap-1 rounded border bg-muted/40 px-2 py-0.5 text-xs">
              {labels[w] || w}
              <button type="button" onClick={() => remove(w)} aria-label="移除">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">未选成员。搜索并选中「刘总」这类联系人（同名多人按备注/wxid 辨别）。</p>
      )}

      <div className="relative">
        <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜全部联系人：备注 / 昵称 / wxid"
          className="h-8 pl-7 text-sm"
        />
        {loading ? (
          <Loader2 className="absolute right-2 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {err ? <p className="text-xs text-red-500">{err}</p> : null}

      {items.length > 0 ? (
        <ul className="max-h-56 divide-y overflow-y-auto rounded border">
          {items.map((c) => {
            const picked = selected.includes(c.wxid);
            return (
              <li key={c.wxid}>
                <button
                  type="button"
                  disabled={picked}
                  onClick={() => add(c)}
                  className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="font-medium">{c.remark || c.nickname || c.wxid}</span>
                    {c.remark && c.nickname ? (
                      <span className="ml-2 text-xs text-muted-foreground">{c.nickname}</span>
                    ) : null}
                    <span className="ml-2 font-mono text-[10px] text-muted-foreground">{c.wxid}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{picked ? '已选' : '＋'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : q.trim() && !loading && !err ? (
        <p className="text-xs text-muted-foreground">无匹配联系人。</p>
      ) : null}
    </div>
  );
}
