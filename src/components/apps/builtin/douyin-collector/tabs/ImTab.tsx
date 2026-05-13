'use client';

import * as React from 'react';
import { MessageSquare, ShieldCheck, Terminal } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAppCollection } from '../use-app-data';

interface CommandRow {
  id: string;
  command?: string;
  risk_level?: string;
  confirmation_required?: boolean;
  status?: string;
  result_summary?: string;
  last_error?: string;
}

interface NotificationRow {
  id: string;
  channel?: string;
  status?: string;
  last_error?: string;
  last_message_id?: string;
}

const RISK_TONE: Record<string, string> = {
  read: 'text-muted-foreground',
  write: 'text-amber-600 dark:text-amber-400',
  external: 'text-rose-600 dark:text-rose-400',
};

export function ImTab(): React.ReactElement {
  const commands = useAppCollection<CommandRow>('app_command_runs');
  const notifications = useAppCollection<NotificationRow>('app_notifications');

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">通知 / 命令</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          外部 IM 命令仅限只读 + 通用命令；高风险动作必须回到应用内确认。
        </p>
      </header>

      <Alert>
        <ShieldCheck className="size-4" />
        <AlertDescription>
          通用命令 <code>/app 抖音采集器 status|runs|acceptance|help</code>{' '}
          始终可用；业务命令在下面的列表中。
        </AlertDescription>
      </Alert>

      <Panel
        icon={<Terminal className="size-3.5" />}
        title="命令模板"
        description="读类命令直接返回结果；写类命令必须回到应用内确认。"
      >
        {commands.error ? (
          <p className="text-xs text-rose-500">{commands.error}</p>
        ) : null}
        {commands.rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">尚无命令模板。</p>
        ) : (
          <ul className="divide-y divide-border">
            {commands.rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-1 py-3">
                <div className="flex items-center justify-between gap-3">
                  <code className="text-sm font-medium">{row.command ?? row.id}</code>
                  <span className={`text-[10px] uppercase tracking-wider ${RISK_TONE[row.risk_level ?? 'read'] ?? 'text-muted-foreground'}`}>
                    {row.risk_level ?? 'read'}
                    {row.confirmation_required ? ' · 需确认' : ''}
                  </span>
                </div>
                {row.result_summary ? (
                  <p className="text-xs text-muted-foreground">{row.result_summary}</p>
                ) : null}
                {row.last_error ? (
                  <p className="text-xs text-rose-500">最近失败：{row.last_error}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        icon={<MessageSquare className="size-3.5" />}
        title="通知通道"
        description="IM 通知失败原因在这里可见；IM 桥未接入时也不会冒充成功。"
      >
        {notifications.rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">尚未配置通知通道。</p>
        ) : (
          <ul className="divide-y divide-border">
            {notifications.rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-3 text-xs">
                <span className="truncate">{row.channel ?? row.id}</span>
                <span className={row.status === 'failed' ? 'text-rose-500' : 'text-muted-foreground'}>
                  {row.status ?? 'unknown'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );
}

function Panel({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      </div>
      {description ? (
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      ) : null}
      <div className="mt-3">{children}</div>
    </div>
  );
}
