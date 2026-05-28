'use client';

// 试爬验证 tab —— 输关键词 → 走 AdsPower+Playwright 爬一页 Etsy 搜索结果 → 原样展示。
// 用来在真实环境验证爬取核心 / 调选择器；不入库。验证对了再接正式采集流程。

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { etsyForgeApi } from '../api-client';

type PreviewResult = Awaited<ReturnType<typeof etsyForgeApi.collectPreview>>;

const STATUS_LABEL: Record<string, string> = {
  ok: 'EHunt 指标已抓到',
  no_ehunt: '未抓到 EHunt 指标',
  not_adspower: '非 AdsPower 上下文（无 EHunt）',
  failed: '采集失败',
};

export function CrawlTestTab() {
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);

  const run = async () => {
    const kw = keyword.trim();
    if (!kw) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await etsyForgeApi.collectPreview(kw, 12));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        试爬一页 Etsy 搜索结果，验证爬取能跑通 + 选择器对不对（不入库）。EHunt 指标需要：设置→采集浏览器选 AdsPower + 该 profile 装了 EHunt 扩展 + 已登录 Etsy。
      </div>

      <div className="mb-6 flex items-center gap-2">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run();
          }}
          placeholder="输入关键词，例如 vintage dog tshirt"
          className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
        />
        <Button disabled={loading || !keyword.trim()} onClick={() => void run()}>
          {loading ? '爬取中…' : '试爬一页'}
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {result && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>抓到 <span className="font-medium text-foreground">{result.products.length}</span> 个商品</span>
            <span>·</span>
            <span>EHunt：<span className="font-medium text-foreground">{STATUS_LABEL[result.ehuntStatus] ?? result.ehuntStatus}</span>（命中 {result.ehuntHitCount}）</span>
            <span>·</span>
            <span>浏览器：{result.browserContextId}</span>
          </div>
          {result.warning && (
            <p className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
              {result.warning}
            </p>
          )}
          <p className="mb-4 text-xs text-muted-foreground">{result.hint}</p>

          {result.products.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {result.products.map((p) => (
                <a
                  key={p.listingId}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-md border hover:ring-1 hover:ring-foreground/30"
                >
                  <div className="aspect-square bg-muted">
                    {p.mainImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.mainImageUrl} alt={p.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                        无主图 URL
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="line-clamp-2 text-xs text-foreground">{p.title || '(无标题)'}</p>
                    {p.price && <p className="mt-1 text-xs text-muted-foreground">{p.price}</p>}
                    {p.ehunt ? (
                      <p className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                        销量 {p.ehunt.salesTotal ?? '?'}
                        {p.ehunt.salesRecent != null ? `(${p.ehunt.salesRecent})` : ''} · 收藏{' '}
                        {p.ehunt.favorites ?? '?'}
                        {p.ehunt.listedDate ? ` · ${p.ehunt.listedDate}` : ''}
                      </p>
                    ) : (
                      <p className="mt-1 text-[10px] text-muted-foreground">无 EHunt</p>
                    )}
                  </div>
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
