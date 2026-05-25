'use client';

import * as React from 'react';

import { Switch } from '@/components/ui/switch';

import type { useCollectorSettings } from '../../use-collector-settings';
import { Section } from './Section';

type SaveFn = ReturnType<typeof useCollectorSettings>['save'];
type ClientSettings = NonNullable<ReturnType<typeof useCollectorSettings>['settings']>;

export function CollectSection({
  settings,
  save,
}: {
  settings: ClientSettings;
  save: SaveFn;
}): React.ReactElement {
  return (
    <Section
      title="采集控制"
      description="控制重复任务和重复视频处理，减少无效请求与 ASR 消耗。"
    >
      <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-3 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">采集去重</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            默认开启。相同目标已有排队/运行任务时直接复用；博主重复采集时跳过已采过的视频，避免重复补元数据和触发后续处理。
          </p>
        </div>
        <Switch
          checked={settings.dedupeCollect !== false}
          onCheckedChange={(value) => void save({ dedupeCollect: value })}
          aria-label="采集去重"
        />
      </div>
    </Section>
  );
}
