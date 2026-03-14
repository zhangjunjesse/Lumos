'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

type PanelType = 'context' | 'workflows' | 'downloads' | null;

interface BrowserSidePanelProps {
  open: PanelType;
  onOpenChange: (open: PanelType) => void;
  contextContent: React.ReactNode;
  workflowsContent: React.ReactNode;
  downloadsContent: React.ReactNode;
}

export function BrowserSidePanel({
  open,
  onOpenChange,
  contextContent,
  workflowsContent,
  downloadsContent,
}: BrowserSidePanelProps) {
  const titles = {
    context: '浏览上下文',
    workflows: 'Workflows',
    downloads: '下载管理',
  };

  if (!open) return null;

  return (
    <div className="fixed right-0 top-0 bottom-0 w-[420px] bg-background border-l flex flex-col z-[9999]">
      <div className="relative border-b px-6 py-4 flex items-center justify-between">
        <h2 className="font-semibold">{titles[open]}</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onOpenChange(null)}
          className="relative z-10 h-8 w-8 hover:bg-accent"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Tabs value={open} onValueChange={(v) => onOpenChange(v as PanelType)} className="flex-1 flex flex-col">
        <TabsList className="grid w-full grid-cols-3 rounded-none border-b">
          <TabsTrigger value="context">上下文</TabsTrigger>
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
          <TabsTrigger value="downloads">下载</TabsTrigger>
        </TabsList>

        <TabsContent value="context" className="flex-1 overflow-auto p-6 m-0">
          {contextContent}
        </TabsContent>

        <TabsContent value="workflows" className="flex-1 overflow-auto p-6 m-0">
          {workflowsContent}
        </TabsContent>

        <TabsContent value="downloads" className="flex-1 overflow-auto p-6 m-0">
          {downloadsContent}
        </TabsContent>
      </Tabs>
    </div>
  );
}
