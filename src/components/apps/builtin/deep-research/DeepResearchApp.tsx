'use client';

import * as React from 'react';
import { Compass } from 'lucide-react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

import { TasksTab } from './tabs/TasksTab';
import { PipelineTab } from './tabs/PipelineTab';
import { SettingsTab } from './tabs/SettingsTab';
import { AutomationsTab } from './tabs/AutomationsTab';
import { ImTab } from './tabs/ImTab';
import { RunHistoryTab } from './tabs/RunHistoryTab';
import { useAppCollection } from './use-app-data';
import type {
  DeepResearchTab,
  ResearchTaskRow,
  ResearchEvidenceRow,
} from './deep-research-types';

const VALID_TABS: ReadonlySet<DeepResearchTab> = new Set([
  'tasks',
  'pipeline',
  'settings',
  'automations',
  'im',
  'run-history',
]);

function isValidTab(value: string | null): value is DeepResearchTab {
  return value !== null && VALID_TABS.has(value as DeepResearchTab);
}

export function DeepResearchApp(): React.ReactElement {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const initialTab = searchParams?.get('tab');
  const initialTaskRef = searchParams?.get('task');
  const [tab, setTabState] = React.useState<DeepResearchTab>(
    isValidTab(initialTab) ? initialTab : 'tasks',
  );
  const [activeTaskId, setActiveTaskIdState] = React.useState<string | null>(initialTaskRef);

  const updateUrl = React.useCallback(
    (nextTab: DeepResearchTab, nextTask: string | null) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      if (nextTab === 'tasks') params.delete('tab');
      else params.set('tab', nextTab);
      if (nextTask) params.set('task', nextTask);
      else params.delete('task');
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setTab = React.useCallback(
    (value: DeepResearchTab) => {
      setTabState(value);
      updateUrl(value, activeTaskId);
    },
    [activeTaskId, updateUrl],
  );

  const setActiveTaskId = React.useCallback(
    (taskId: string | null) => {
      setActiveTaskIdState(taskId);
      const nextTab: DeepResearchTab = taskId ? 'pipeline' : 'tasks';
      setTabState(nextTab);
      updateUrl(nextTab, taskId);
    },
    [updateUrl],
  );

  React.useEffect(() => {
    if (isValidTab(initialTab) && initialTab !== tab) {
      setTabState(initialTab);
    }
    if (initialTaskRef !== activeTaskId) {
      setActiveTaskIdState(initialTaskRef);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab, initialTaskRef]);

  const { rows: tasks } = useAppCollection<ResearchTaskRow>('research_tasks');
  const { rows: evidence } = useAppCollection<ResearchEvidenceRow>('research_evidence');
  const activeCount = tasks.filter((t) => t.status === 'active').length;
  const deliveredCount = tasks.filter((t) => t.status === 'delivered').length;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="border-b bg-card px-9 py-6">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-sky-500 text-white shadow-sm">
            <Compass className="size-6" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight">深度调研</h1>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              对话驱动的端到端调研工作台。澄清 → 目标 → 拆解 → 风险 → 采集 → 综合 → 报告 → 自检，
              每阶段都有可见的用户确认与失败原因，绝不跳阶段、不用 mock 数据冒充完成。
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="rounded-full">
                {tasks.length} 个调研任务
              </Badge>
              <Badge variant="outline" className="rounded-full">
                {activeCount} 进行中
              </Badge>
              <Badge variant="outline" className="rounded-full">
                {deliveredCount} 已交付
              </Badge>
              <Badge variant="outline" className="rounded-full">
                {evidence.length} 条证据
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as DeepResearchTab)}
        className="min-h-0 flex-1"
      >
        <div className="overflow-x-auto border-b bg-muted/20">
          <TabsList className="mx-auto h-auto min-w-max gap-1 bg-transparent px-9 py-1.5">
            <TabsTrigger value="tasks" className="data-[state=active]:bg-background">
              调研任务
            </TabsTrigger>
            <TabsTrigger
              value="pipeline"
              disabled={!activeTaskId}
              className="data-[state=active]:bg-background"
            >
              SOP 工作台
            </TabsTrigger>
            <TabsTrigger value="settings" className="data-[state=active]:bg-background">
              设置
            </TabsTrigger>
            <TabsTrigger value="automations" className="data-[state=active]:bg-background">
              自动化
            </TabsTrigger>
            <TabsTrigger value="im" className="data-[state=active]:bg-background">
              通知命令
            </TabsTrigger>
            <TabsTrigger value="run-history" className="data-[state=active]:bg-background">
              运行结果
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="h-full overflow-y-auto">
          <TabsContent value="tasks" className="m-0 px-9 py-6">
            <TasksTab tasks={tasks} onOpen={setActiveTaskId} />
          </TabsContent>
          <TabsContent value="pipeline" className="m-0 px-9 py-6">
            <PipelineTab
              taskId={activeTaskId}
              onBack={() => setActiveTaskId(null)}
            />
          </TabsContent>
          <TabsContent value="settings" className="m-0 px-9 py-6">
            <SettingsTab />
          </TabsContent>
          <TabsContent value="automations" className="m-0 px-9 py-6">
            <AutomationsTab />
          </TabsContent>
          <TabsContent value="im" className="m-0 px-9 py-6">
            <ImTab />
          </TabsContent>
          <TabsContent value="run-history" className="m-0 px-9 py-6">
            <RunHistoryTab />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
