'use client';

import * as React from 'react';
import { AlertCircle } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { api } from './api';
import { AutomationsTab } from './AutomationsTab';
import { HistoryTab } from './HistoryTab';
import { QueryTab } from './QueryTab';
import { SettingsTab } from './SettingsTab';
import type { StatusDto } from './types';

type TabValue = 'query' | 'history' | 'automations' | 'settings';

export function AmazonRankApp(): React.ReactElement {
  const [tab, setTab] = React.useState<TabValue>('query');
  const [status, setStatus] = React.useState<StatusDto | null>(null);

  const refreshStatus = React.useCallback(async () => {
    try {
      setStatus(await api.status());
    } catch {
      setStatus(null);
    }
  }, []);

  React.useEffect(() => {
    void refreshStatus();
    const timer = setInterval(() => void refreshStatus(), 15_000);
    return () => clearInterval(timer);
  }, [refreshStatus]);

  const bridgeDown = status !== null && !status.bridge.connected;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-9 pb-4 pt-6">
        <h1 className="text-xl font-semibold tracking-tight">亚马逊排名助手</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          输入关键词和 ASIN，查亚马逊自然搜索前 20 名排名。查不到会如实标原因，不编数据。
        </p>
      </div>

      {bridgeDown ? (
        <div className="px-9 pt-4">
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>
              浏览器未连接：请确认 Lumos 桌面端已启动。{status?.bridge.error ?? ''}
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as TabValue)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="border-b">
          <TabsList className="h-auto gap-1 bg-transparent px-9 py-1.5">
            <TabsTrigger value="query" className="data-[state=active]:bg-background">查询</TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-background">历史</TabsTrigger>
            <TabsTrigger value="automations" className="data-[state=active]:bg-background">自动化</TabsTrigger>
            <TabsTrigger value="settings" className="data-[state=active]:bg-background">设置</TabsTrigger>
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="query" className="m-0 px-9 py-6">
            <QueryTab status={status} onStatusChange={refreshStatus} />
          </TabsContent>
          <TabsContent value="history" className="m-0 px-9 py-6">
            <HistoryTab active={tab === 'history'} />
          </TabsContent>
          <TabsContent value="automations" className="m-0 px-9 py-6">
            <AutomationsTab active={tab === 'automations'} />
          </TabsContent>
          <TabsContent value="settings" className="m-0 px-9 py-6">
            <SettingsTab active={tab === 'settings'} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
