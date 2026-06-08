'use client';

// Etsy 选品采集 — 应用外壳（Lumos 统一框架）。
// 关键词爬 Etsy 商品（主图 + EHunt 指标）→ 勾选 → 爬详情图入图库。全程浏览器爬取，不调图片服务商。

import * as React from 'react';
import { Palette } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { TasksTab } from './tabs/TasksTab';
import { ProductsTab } from './tabs/ProductsTab';
import { LibraryTab } from './tabs/LibraryTab';
import { ShopsTab } from './tabs/ShopsTab';
import { AssetsTab } from './tabs/AssetsTab';
import { ProductTab } from './tabs/ProductTab';
import { WarehouseTab } from './tabs/WarehouseTab';
import { CreationDock } from './CreationDock';
import { SopTaskDock } from './SopTaskDock';
import { LogsTab } from './tabs/LogsTab';
import { SettingsTab } from './tabs/SettingsTab';

type TabValue = 'tasks' | 'products' | 'library' | 'shops' | 'assets' | 'product' | 'warehouse' | 'logs' | 'settings';

export function EtsyForgeApp(): React.ReactElement {
  const [tab, setTab] = React.useState<TabValue>('tasks');
  const [refreshKey, setRefreshKey] = React.useState(0);
  const refresh = React.useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-background">
      <header className="border-b bg-card px-9 py-6">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-fuchsia-500 text-white shadow-sm">
            <Palette className="size-6" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight">Etsy 选品采集</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              关键词爬 Etsy 商品（主图 + EHunt 指标）→ 勾选 → 爬详情图入图库 · 全程浏览器爬取，不调图片服务商
            </p>
          </div>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)} className="flex min-h-0 flex-1 flex-col">
        <div className="border-b bg-muted/20">
          <TabsList className="h-auto gap-1 bg-transparent px-9 py-1.5">
            <TabsTrigger value="tasks" className="data-[state=active]:bg-background">
              采集任务
            </TabsTrigger>
            <TabsTrigger value="products" className="data-[state=active]:bg-background">
              已采集商品
            </TabsTrigger>
            <TabsTrigger value="library" className="data-[state=active]:bg-background">
              我关注的商品
            </TabsTrigger>
            <TabsTrigger value="shops" className="data-[state=active]:bg-background">
              我关注的店铺
            </TabsTrigger>
            <TabsTrigger value="assets" className="data-[state=active]:bg-background">
              我的图库
            </TabsTrigger>
            <TabsTrigger value="warehouse" className="data-[state=active]:bg-background">
              我的灵感
            </TabsTrigger>
            <TabsTrigger value="product" className="data-[state=active]:bg-background">
              我的产品
            </TabsTrigger>
            <TabsTrigger value="logs" className="data-[state=active]:bg-background">
              日志
            </TabsTrigger>
            <TabsTrigger value="settings" className="data-[state=active]:bg-background">
              设置
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="tasks" className="m-0 px-9 py-6">
            <TasksTab key={`t-${refreshKey}`} onCollected={refresh} />
          </TabsContent>
          <TabsContent value="products" className="m-0 px-9 py-6">
            <ProductsTab key={`p-${refreshKey}`} onCollectedDetails={refresh} />
          </TabsContent>
          <TabsContent value="library" className="m-0 px-9 py-6">
            <LibraryTab key={`l-${refreshKey}`} />
          </TabsContent>
          <TabsContent value="shops" className="m-0 px-9 py-6">
            <ShopsTab key={`s-${refreshKey}`} />
          </TabsContent>
          <TabsContent value="assets" className="m-0 px-9 py-6">
            <AssetsTab key={`a-${refreshKey}`} />
          </TabsContent>
          <TabsContent value="warehouse" className="m-0 px-9 py-6">
            <WarehouseTab />
          </TabsContent>
          <TabsContent value="product" className="m-0 px-9 py-6">
            <ProductTab />
          </TabsContent>
          <TabsContent value="logs" className="m-0 px-9 py-6">
            <LogsTab />
          </TabsContent>
          <TabsContent value="settings" className="m-0 px-9 py-6">
            <SettingsTab />
          </TabsContent>
        </div>
      </Tabs>

      <CreationDock />
      <SopTaskDock />
    </div>
  );
}
