'use client';

import * as React from 'react';
import { Library, Play, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { useCollectSources } from '../../use-collect-sources';
import type { useJobs } from '../../use-jobs';
import type { CreatorCadence } from '@/lib/douyin-collector/types';
import { QualityPill } from '../../components/QualityPill';

export const CADENCE_LABELS: Record<CreatorCadence, string> = {
  hourly: '每小时',
  daily: '每天',
  weekly: '每周',
  manual: '手动',
};

export function CreatorSection({
  sources,
  jobs,
  onShowVideos,
}: {
  sources: ReturnType<typeof useCollectSources>;
  jobs: ReturnType<typeof useJobs>;
  onShowVideos?: (creatorRef: string, label: string) => void;
}): React.ReactElement {
  const [input, setInput] = React.useState('');
  const [nickname, setNickname] = React.useState('');
  const [cadence, setCadence] = React.useState<CreatorCadence>('daily');
  const [adding, setAdding] = React.useState(false);
  const [addError, setAddError] = React.useState<string | null>(null);

  async function onAdd() {
    setAddError(null);
    setAdding(true);
    try {
      await sources.addCreator({ input: input.trim(), nickname: nickname.trim(), cadence });
      setInput('');
      setNickname('');
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold tracking-tight">博主订阅</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        粘贴主页分享链接（v.douyin.com 短链或 www.douyin.com/user/...）或 sec_uid；不能只填博主昵称。
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_180px_120px_auto]">
        <Input
          placeholder="主页分享链接 / sec_uid"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <Input
          placeholder="备注昵称（可选）"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
        <Select value={cadence} onValueChange={(v) => setCadence(v as CreatorCadence)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(CADENCE_LABELS) as CreatorCadence[]).map((c) => (
              <SelectItem key={c} value={c}>
                {CADENCE_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={onAdd} disabled={adding || !input.trim()}>
          <Plus className="size-3.5" />
          添加
        </Button>
      </div>
      {addError ? <p className="mt-2 text-xs text-rose-500">{addError}</p> : null}

      <div className="mt-4 divide-y divide-border">
        {sources.creators.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            还没有订阅。试着粘贴一个抖音博主主页链接。
          </p>
        ) : (
          sources.creators.map((c) => {
            const secUid = typeof c.sec_uid === 'string' ? c.sec_uid : '';
            const hasSecUid = secUid.length > 0;
            const stats = hasSecUid ? sources.creatorStats[secUid] : undefined;
            return (
              <div key={c.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {hasSecUid ? (
                      <a
                        href={`https://www.douyin.com/user/${secUid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="transition-colors hover:text-foreground/70"
                        title="在抖音打开主页"
                      >
                        {c.nickname}
                      </a>
                    ) : (
                      c.nickname
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                    <span>
                      {hasSecUid ? `sec_uid · ${secUid.slice(0, 18)}…` : '旧版无效订阅'} ·{' '}
                      {CADENCE_LABELS[c.cadence]}
                    </span>
                    {!hasSecUid ? (
                      <span className="text-rose-500">
                        · 缺主页 ID，不能采集；请删除后粘贴博主主页链接重新添加
                      </span>
                    ) : null}
                    {stats ? (
                      <span>
                        · 已采集 {stats.collected} · 已转写 {stats.transcribed} · 已入库{' '}
                        {stats.published}
                      </span>
                    ) : null}
                    {stats ? <QualityPill stats={stats} /> : null}
                    {c.last_failure_reason ? (
                      <span className="text-rose-500">· 失败：{c.last_failure_reason}</span>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {onShowVideos && hasSecUid ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onShowVideos(secUid, c.nickname)}
                      title="切到资料库，只看这位博主的视频"
                    >
                      <Library className="size-3.5" />
                      查看资料
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!hasSecUid}
                    onClick={() =>
                      void jobs.enqueue({
                        kind: 'creator',
                        targetRef: c.id,
                        creatorCollectMode: 'recent',
                        maxVideos: 80,
                      })
                    }
                    title={
                      hasSecUid
                        ? '立即采集该博主'
                        : '旧版订阅缺 sec_uid，需删除后粘贴博主主页链接重新添加'
                    }
                  >
                    <Play className="size-3.5" />
                    立即采集
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!hasSecUid}
                    onClick={() =>
                      void jobs.enqueue({
                        kind: 'creator',
                        targetRef: c.id,
                        creatorCollectMode: 'full',
                        maxVideos: 300,
                      })
                    }
                    title={
                      hasSecUid
                        ? '长滚动采集该博主，最多发现 300 条视频'
                        : '旧版订阅缺 sec_uid，需删除后粘贴博主主页链接重新添加'
                    }
                  >
                    采集全部
                  </Button>
                  <Switch
                    checked={c.enabled}
                    onCheckedChange={(v) => void sources.toggleCreator(c.id, v)}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => void sources.deleteCreator(c.id)}
                    aria-label="删除"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
