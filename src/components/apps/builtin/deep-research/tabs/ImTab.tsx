'use client';

import * as React from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

import { useAppCollection } from '../use-app-data';

interface NotificationRow {
  id: string;
  target_label?: string;
  channel?: string;
  status?: string;
  last_error?: string | null;
}

interface CommandRow {
  id: string;
  command?: string;
  risk_level?: string;
  status?: string;
  result_summary?: string;
  failure_reason?: string | null;
  confirmation_required?: boolean;
}

export function ImTab(): React.ReactElement {
  const notifications = useAppCollection<NotificationRow>('app_notifications');
  const commands = useAppCollection<CommandRow>('app_command_runs');

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">通知命令</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            微信 IM 通知接入边界与可见命令模板。外部微信可发 /app 深度调研 status|runs|acceptance|help；
            业务写操作和高风险命令必须回到应用内确认。
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void notifications.refresh();
            void commands.refresh();
          }}
        >
          <RefreshCw className="mr-1.5 size-4" />
          刷新
        </Button>
      </div>

      {(notifications.error || commands.error) && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{notifications.error ?? commands.error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">通知目标</h3>
        {notifications.loading ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : notifications.rows.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              尚未配置通知目标。首次发送前请在微信里给 Lumos/Clawbot 发一条消息完成绑定。
            </CardContent>
          </Card>
        ) : (
          notifications.rows.map((row) => (
            <Card key={row.id}>
              <CardContent className="space-y-2 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{row.target_label}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {row.channel}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {row.status}
                  </Badge>
                </div>
                {row.last_error && (
                  <div className="text-xs text-amber-700 dark:text-amber-400">
                    失败原因：{row.last_error}
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">命令模板</h3>
        {commands.loading ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : commands.rows.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              尚未注入默认命令。安装时会写入 /research tasks|plan|report|risk 与 /app 通用命令。
            </CardContent>
          </Card>
        ) : (
          commands.rows.map((row) => (
            <Card key={row.id}>
              <CardContent className="space-y-2 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{row.command}</code>
                  <Badge variant="outline" className="text-[10px]">
                    {row.risk_level}
                  </Badge>
                  {row.confirmation_required && (
                    <Badge variant="secondary" className="text-[10px]">
                      需确认
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[10px]">
                    {row.status}
                  </Badge>
                </div>
                {row.result_summary && (
                  <div className="text-xs text-muted-foreground">{row.result_summary}</div>
                )}
                {row.failure_reason && (
                  <div className="text-xs text-amber-700 dark:text-amber-400">
                    失败原因：{row.failure_reason}
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
