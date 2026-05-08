'use client';

import { useState } from 'react';
import { Loader2, Search, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { XAuthExpiredHint } from './XAuthExpiredHint';

interface Hit {
  id: string;
  authorScreenName: string;
  authorName: string;
  text: string;
  createdAt: number;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  url: string;
}

export function XSearchSection() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authExpired, setAuthExpired] = useState(false);

  const onSearch = async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/x/search?q=${encodeURIComponent(q)}&count=20`, { cache: 'no-store' });
      const data = await res.json();
      if (res.status === 401 && data?.code === 'X_AUTH_EXPIRED') {
        setAuthExpired(true);
        setHits(null);
        return;
      }
      if (!res.ok || !data?.ok) throw new Error(data?.message || `HTTP ${res.status}`);
      setAuthExpired(false);
      setHits(data.hits || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void onSearch(); }}
          placeholder="搜索 X 上的推文 (支持 X 高级搜索语法,如 from:elonmusk)"
          className="w-full pl-9 pr-20 py-2 text-sm bg-muted/30 rounded-md focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
        <Button
          size="sm"
          onClick={() => void onSearch()}
          disabled={loading || !query.trim()}
          className="absolute right-1 top-1/2 -translate-y-1/2 h-7"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : '搜索'}
        </Button>
      </div>

      {authExpired && <XAuthExpiredHint />}
      {error && !authExpired && (
        <div className="text-sm text-red-500">搜索失败：{error}</div>
      )}

      {hits && hits.length === 0 && !loading && !error && !authExpired && (
        <div className="text-sm text-muted-foreground text-center py-4">没有找到匹配推文</div>
      )}

      {hits && hits.length > 0 && (
        <ul className="divide-y divide-border/60 max-h-[60vh] overflow-y-auto -mx-4 px-4">
          {hits.map((h) => (
            <li key={h.id} className="py-3 space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{h.authorName || h.authorScreenName}</span>
                {h.authorScreenName && <span>@{h.authorScreenName}</span>}
                <span>·</span>
                <span>{formatRelative(h.createdAt)}</span>
                <a href={h.url} target="_blank" rel="noreferrer" className="ml-auto opacity-60 hover:opacity-100">
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <div className="text-sm whitespace-pre-wrap break-words">{h.text}</div>
              <div className="text-xs text-muted-foreground flex gap-3">
                <span>♻ {h.retweetCount}</span>
                <span>♥ {h.likeCount}</span>
                <span>💬 {h.replyCount}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatRelative(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / 60 / 60_000)} 小时前`;
  const d = new Date(ts);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
