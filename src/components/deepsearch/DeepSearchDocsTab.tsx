"use client";

import { useEffect, useState } from 'react';
import { ExternalLink, FileText, Image, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DeepSearchRecord } from './deepsearch-types';
import { buildArtifactUrl, formatTimestamp } from './deepsearch-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTranslation } from '@/hooks/useTranslation';

type RecordWithQuery = DeepSearchRecord & { runQueryText: string };

function cap(s: string) { return s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(''); }

interface Props {
  records: RecordWithQuery[];
  selectedRecordId: string;
  selectedRecord: RecordWithQuery | null;
  siteNameMap: Map<string, string>;
  onSelectRecord: (id: string) => void;
}

function DocDetail({ record, siteNameMap }: { record: RecordWithQuery; siteNameMap: Map<string, string> }) {
  const { t } = useTranslation();
  const [contentText, setContentText] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const siteName = record.siteKey ? (siteNameMap.get(record.siteKey) ?? record.siteKey) : null;

  // Load full content when record changes
  useEffect(() => {
    setContentText(null);
    if (!record.contentArtifact) return;
    setContentLoading(true);
    fetch(buildArtifactUrl(record.contentArtifact.id))
      .then((res) => res.ok ? res.text() : null)
      .then((text) => setContentText(text))
      .catch(() => setContentText(null))
      .finally(() => setContentLoading(false));
  }, [record.id, record.contentArtifact]);

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-1 pr-3">
        {/* Title + meta */}
        <div>
          <h3 className="text-sm font-semibold leading-5">{record.title || record.url || '-'}</h3>
          {record.url ? (
            <div className="mt-1 flex items-center gap-1">
              <span className="text-xs text-muted-foreground break-all select-all cursor-text">{record.url}</span>
              <a href={record.url} target="_blank" rel="noreferrer" className="flex-shrink-0 text-muted-foreground hover:text-foreground">
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {siteName ? <Badge variant="outline" className="text-xs">{siteName}</Badge> : null}
            <Badge variant={record.contentState === 'full' ? 'default' : record.contentState === 'failed' ? 'destructive' : 'secondary'} className="text-xs">
              {t(`deepsearch.contentState${cap(record.contentState)}` as Parameters<typeof t>[0])}
            </Badge>
            <span className="text-xs text-muted-foreground">{formatTimestamp(record.fetchedAt)}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            来源任务: {record.runQueryText}
          </p>
        </div>

        {/* Error */}
        {record.errorMessage ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-xs text-destructive">{record.errorMessage}</p>
          </div>
        ) : null}

        {/* Screenshot */}
        {record.screenshotArtifact ? (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Image className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">{t('deepsearch.artifactKindScreenshot')}</span>
              <Button variant="ghost" size="sm" className="h-6 text-xs ml-auto"
                onClick={() => window.open(buildArtifactUrl(record.screenshotArtifact!.id), '_blank')}>
                新窗口打开
              </Button>
            </div>
            <div className="overflow-hidden rounded-lg border">
              <img
                src={buildArtifactUrl(record.screenshotArtifact.id)}
                alt={record.title || ''}
                className="w-full object-contain max-h-80"
              />
            </div>
          </div>
        ) : null}

        {/* Content */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">{t('deepsearch.artifactKindContent')}</span>
            {record.contentArtifact ? (
              <Button variant="ghost" size="sm" className="h-6 text-xs ml-auto"
                onClick={() => window.open(buildArtifactUrl(record.contentArtifact!.id), '_blank')}>
                新窗口打开
              </Button>
            ) : null}
          </div>
          {contentLoading ? (
            <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载正文...
            </div>
          ) : contentText ? (
            <div className="rounded-lg border bg-muted/20 p-4">
              <pre className="text-xs leading-6 whitespace-pre-wrap break-words font-sans">{contentText}</pre>
            </div>
          ) : record.snippet ? (
            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-xs leading-5 text-muted-foreground">{record.snippet}</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic p-4">{t('deepsearch.noRecordSnippet')}</p>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}

export function DeepSearchDocsTab({ records, selectedRecordId, selectedRecord, siteNameMap, onSelectRecord }: Props) {
  const { t } = useTranslation();

  return (
    <div className="grid min-h-0 flex-1 gap-4" style={{ gridTemplateColumns: '300px minmax(0,1fr)' }}>
      {/* Left: document list */}
      <ScrollArea className="min-h-0">
        {records.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground text-center">还没有抓取过内容。</p>
        ) : (
          <div className="space-y-2 pr-2">
            {records.map((rec) => {
              const siteName = rec.siteKey ? (siteNameMap.get(rec.siteKey) ?? rec.siteKey) : null;
              return (
                <button key={rec.id} type="button" onClick={() => onSelectRecord(rec.id)}
                  className={cn(
                    "w-full rounded-xl border p-3 text-left transition-colors hover:bg-muted/50",
                    rec.id === selectedRecordId && "border-primary bg-primary/5",
                  )}>
                  <p className="line-clamp-2 text-xs font-medium leading-4">{rec.title || rec.url || '-'}</p>
                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    {siteName ? <Badge variant="outline" className="h-4 text-[10px] px-1.5">{siteName}</Badge> : null}
                    <Badge variant={rec.contentState === 'full' ? 'default' : rec.contentState === 'failed' ? 'destructive' : 'secondary'} className="h-4 text-[10px] px-1.5">
                      {t(`deepsearch.contentState${cap(rec.contentState)}` as Parameters<typeof t>[0])}
                    </Badge>
                  </div>
                  {rec.snippet ? <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{rec.snippet}</p> : null}
                  <p className="mt-1 text-xs text-muted-foreground">{formatTimestamp(rec.fetchedAt)}</p>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Right: document detail */}
      <div className="min-h-0">
        {selectedRecord ? (
          <DocDetail record={selectedRecord} siteNameMap={siteNameMap} />
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed">
            <p className="text-sm text-muted-foreground">选择一个文档查看详情</p>
          </div>
        )}
      </div>
    </div>
  );
}
