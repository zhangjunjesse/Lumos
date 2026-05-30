'use client';

// 商品评论弹框：列出该商品已抓评论 + AI 分析。打开时若无缓存分析且有评论则自动跑一次。

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { etsyForgeApi, type Review, type ReviewAnalysis } from '../api-client';
import { ReviewAnalysisView } from './ReviewAnalysisView';
import { QuickAddChat } from './QuickAddChat';

// 把结构化分析压成一段可读文字，丢进创作助手当卖点参考。
function analysisToText(a: ReviewAnalysis, title: string): string {
  const topics = (label: string, arr: ReviewAnalysis['pros']) =>
    arr.length ? `${label}：${arr.map((t) => `${t.topic}(${t.reason})`).join('；')}` : '';
  return [
    `商品「${title}」评论分析（${a.reviewsAnalyzed} 条）`,
    `客户：${a.customerProfile.who}；使用场景：${a.customerProfile.what}`,
    topics('卖点', a.pros),
    topics('痛点', a.cons),
    topics('购买动机', a.motivations),
    topics('期待', a.expectations),
  ]
    .filter(Boolean)
    .join('\n');
}

export function ReviewModal({
  productId,
  title,
  onClose,
}: {
  productId: string;
  title: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [analysis, setAnalysis] = useState<ReviewAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [recollecting, setRecollecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const r = await etsyForgeApi.analyzeReviews(productId);
      setAnalysis(r.analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  }, [productId]);

  // 重新抓取：后台浏览器重开商品页抓评论（较慢），只更新评论；抓完刷新列表、旧分析作废后自动重跑。
  const recollect = useCallback(async () => {
    if (!confirm('重新抓取评论？会用后台浏览器重开商品页抓一遍（较慢），只更新评论、不动详情图。')) return;
    setRecollecting(true);
    setError(null);
    try {
      const r = await etsyForgeApi.recollectReviews(productId);
      const fresh = await etsyForgeApi.listReviews(productId);
      setReviews(fresh.reviews);
      setAnalysis(null);
      if (r.count > 0) void runAnalyze();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRecollecting(false);
    }
  }, [productId, runAnalyze]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await etsyForgeApi.listReviews(productId);
        if (cancelled) return;
        setReviews(r.reviews);
        setAnalysis(r.analysis);
        if (!r.analysis && r.reviews.length > 0) void runAnalyze();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId, runAnalyze]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border bg-background"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <h2 className="flex-1 truncate text-sm font-medium">评论分析 · {title || '(无标题)'}</h2>
          {analysis && (
            <Button
              size="sm"
              variant="outline"
              title="把卖点/痛点丢进底部创作助手"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('insert-text-to-chat', {
                    detail: { text: analysisToText(analysis, title), label: '评论分析' },
                  }),
                )
              }
            >
              加入对话
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={recollecting || analyzing} onClick={() => void recollect()}>
            {recollecting ? '抓取中…' : '重新抓取'}
          </Button>
          <Button size="sm" variant="outline" disabled={analyzing || recollecting || reviews.length === 0} onClick={() => void runAnalyze()}>
            {analyzing ? '分析中…' : analysis ? '重新分析' : '分析'}
          </Button>
          <button type="button" onClick={onClose} aria-label="关闭" className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {loading && <p className="text-sm text-muted-foreground">加载中…</p>}
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {!loading && reviews.length === 0 && !error && (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              这个商品还没抓到评论。点上方「重新抓取」直接抓一次，或去「已采集商品」重爬详情（会顺带抓评论）。
            </div>
          )}
          {analyzing && !analysis && (
            <p className="text-sm text-muted-foreground">AI 正在分析 {reviews.length} 条评论…</p>
          )}
          {analysis && <ReviewAnalysisView analysis={analysis} />}

          {reviews.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-medium">全部评论（{reviews.length}）</h3>
              <div className="space-y-2">
                {reviews.map((r) => (
                  <div key={r.id} className="group relative rounded-md border p-2 text-xs">
                    <QuickAddChat text={r.text} refLabel="评论" className="absolute right-1 top-1" label="这条评论加到创作助手" />
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      {r.rating && <span className="text-amber-600 dark:text-amber-400">★ {r.rating}</span>}
                      {r.author && <span>{r.author}</span>}
                      {r.date && <span>{r.date}</span>}
                      {r.region && <span>{r.region}</span>}
                    </div>
                    <p className="whitespace-pre-line text-foreground">{r.text}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
