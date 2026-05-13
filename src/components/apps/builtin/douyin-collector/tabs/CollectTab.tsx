'use client';

import * as React from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { useCollectSources } from '../use-collect-sources';
import { useDouyinStatus } from '../use-douyin-status';
import { useJobs } from '../use-jobs';

import { CreatorSection } from './collect/CreatorSection';
import { KeywordSection } from './collect/KeywordSection';
import { QuickLinkSection } from './collect/QuickLinkSection';
import { RecentJobsPanel } from './collect/RecentJobsPanel';

export function CollectTab({
  onKeywordTagClick,
  onCreatorShowVideos,
  onOpenSettings,
}: {
  onKeywordTagClick?: (tag: string) => void;
  onCreatorShowVideos?: (creatorRef: string, label: string) => void;
  onOpenSettings?: () => void;
} = {}): React.ReactElement {
  const sources = useCollectSources();
  const jobs = useJobs();
  const { status } = useDouyinStatus();

  // Round 171: surface cookie state in the surface where it actually
  // matters. Users add a creator/keyword sub here, click "立即采集",
  // and discover failure only after the job runs. Pre-warn if they
  // have ≥1 subscription but no cookie configured.
  const subsCount = sources.creators.length + sources.keywords.length;
  const cookieMissing = !status?.auth?.cookieValid && subsCount > 0;

  const refreshAll = React.useCallback(() => {
    void sources.refresh();
    void jobs.refresh();
  }, [sources, jobs]);

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">采集来源</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            三种入口：粘链接（最稳，任何视频都行）；订阅博主（cadence 自动巡更）；订阅关键词
            （走抖音搜索页）。后两者通过内置浏览器抓取，前提是
            <strong className="font-semibold text-foreground/90">「设置 → Cookie」</strong>
            配好登录态。
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refreshAll}
          disabled={sources.loading || jobs.loading}
        >
          <RefreshCcw className="size-3.5" />
          刷新
        </Button>
      </header>

      {sources.error ? (
        <Alert variant="destructive">
          <AlertDescription>{sources.error}</AlertDescription>
        </Alert>
      ) : null}

      {cookieMissing ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300/40 bg-amber-50 px-4 py-3 text-sm dark:border-amber-300/20 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">未配置抖音 Cookie</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              你已订阅 {subsCount} 个博主 / 关键词，但 cookie 还没设。内置浏览器加载 douyin
              页面时会被反爬识别为匿名访客，feed 拿不到——「立即采集」会失败并提示你来这里设置。
              {onOpenSettings ? (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="underline-offset-2 hover:underline"
                  >
                    去「设置 → Cookie」配置 →
                  </button>
                </>
              ) : null}
            </p>
          </div>
        </div>
      ) : null}

      <QuickLinkSection jobs={jobs} />
      <CreatorSection sources={sources} jobs={jobs} onShowVideos={onCreatorShowVideos} />
      <KeywordSection sources={sources} jobs={jobs} onTagClick={onKeywordTagClick} />
      <RecentJobsPanel jobs={jobs} sources={sources} />
    </section>
  );
}
