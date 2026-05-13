'use client';

import * as React from 'react';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { useCollectorSettings } from '../../use-collector-settings';
import { Section } from './Section';

type SaveFn = ReturnType<typeof useCollectorSettings>['save'];
type ClientSettings = NonNullable<ReturnType<typeof useCollectorSettings>['settings']>;

export interface KnowledgeCollection {
  id: string;
  name: string;
}

const DEFAULT_LIBRARY_COLLECTION_NAME = '联网搜索资料';

export function LibrarySection({
  settings,
  save,
  collections,
  collectionsErr,
}: {
  settings: ClientSettings;
  save: SaveFn;
  collections: KnowledgeCollection[];
  collectionsErr: string | null;
}): React.ReactElement {
  return (
    <Section
      title="入库目标"
      description="转写后的视频默认写入「联网搜索资料」；默认草稿态，需要在「整理」页确认才发布。"
    >
      {collectionsErr ? (
        <Alert variant="destructive">
          <AlertDescription>读取知识库失败：{collectionsErr}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>默认资料库</Label>
          <div className="mt-1.5 flex h-9 items-center rounded-md border border-input bg-muted/30 px-3 text-sm">
            {collectionLabel(settings.libraryCollectionId, collections)}
          </div>
        </div>
        <div className="flex items-end gap-3 sm:col-span-2">
          <div className="flex-1">
            <Label className="block">采集后自动抓字幕</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              巡更或手动采集发现新视频后，自动顺序抓取字幕。失败的视频不会阻塞队列，每批一条
              run_history 汇总。这是自动化链的入口；自动入库在它打开后才会生效。
            </p>
          </div>
          <Switch
            checked={settings.autoTranscribe}
            onCheckedChange={(v) => void save({ autoTranscribe: v })}
          />
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Label className="block">自动入库</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              转写完成后直接发布到 collection（跳过草稿）。资料库索引会在入库时生成概述、要点和标签。
              {/* Round 172: a true=enabled toggle without a target
                  collection silently no-ops in maybeAutoPublish. Make
                  the dependency explicit: disabled until user picks a
                  collection above. */}
              {!settings.libraryCollectionId ? (
                <span className="mt-1 block text-amber-600 dark:text-amber-400">
                  需要先在上面选「默认 collection」；自动入库才能知道往哪发。
                </span>
              ) : null}
            </p>
          </div>
          <Switch
            checked={settings.autoPublish && !!settings.libraryCollectionId}
            disabled={!settings.autoTranscribe || !settings.libraryCollectionId}
            onCheckedChange={(v) => void save({ autoPublish: v })}
          />
        </div>
      </div>
    </Section>
  );
}

function collectionLabel(
  collectionId: string | null,
  collections: KnowledgeCollection[],
): string {
  const current = collections.find((collection) => collection.id === collectionId);
  return current?.name || DEFAULT_LIBRARY_COLLECTION_NAME;
}
