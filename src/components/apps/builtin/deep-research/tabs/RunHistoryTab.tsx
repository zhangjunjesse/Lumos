'use client';

import * as React from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

import { useAppCollection } from '../use-app-data';

interface RunHistoryRow {
  id: string;
  title?: string;
  status?: string;
  summary?: string;
  failure_reason?: string | null;
  updated_at?: string;
}

export function RunHistoryTab(): React.ReactElement {
  const { rows, loading, error, refresh } = useAppCollection<RunHistoryRow>(
    'run_history',
    { sortKey: 'updated_at', sortDir: 'desc' },
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">运行结果</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            自动化、AI 处理与 IM 命令的运行记录。失败时这里会显示 failure_reason，便于重试。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="mr-1.5 size-4" />
          刷新
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            尚无运行记录。完成一次自动化或调研推进后会自动写入。
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2">
          {rows.map((row) => (
            <Card key={row.id}>
              <CardContent className="space-y-1.5 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{row.title ?? '（未命名）'}</span>
                  <Badge
                    variant={row.status === 'failed' ? 'destructive' : 'outline'}
                    className="text-[10px]"
                  >
                    {row.status}
                  </Badge>
                  {row.updated_at && (
                    <span className="text-xs text-muted-foreground">{row.updated_at}</span>
                  )}
                </div>
                {row.summary && <div className="text-xs text-muted-foreground">{row.summary}</div>}
                {row.failure_reason && (
                  <div className="text-xs text-amber-700 dark:text-amber-400">
                    失败原因：{row.failure_reason}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
