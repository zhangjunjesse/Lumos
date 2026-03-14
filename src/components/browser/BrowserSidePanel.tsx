'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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

  return (
    <Sheet modal={false} open={!!open} onOpenChange={(isOpen) => !isOpen && onOpenChange(null)}>
      <SheetContent
        side="right"
        className="z-[100] w-[420px] p-0 border-l-0"
        showCloseButton={false}
        showOverlay={false}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <SheetHeader className="relative z-20 border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <SheetTitle>{open && titles[open]}</SheetTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(null)}
              className="relative z-30 h-8 w-8 hover:bg-accent"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </SheetHeader>

        <Tabs value={open || 'context'} onValueChange={(v) => onOpenChange(v as PanelType)} className="h-[calc(100%-73px)]">
          <TabsList className="grid w-full grid-cols-3 rounded-none border-b">
            <TabsTrigger value="context">上下文</TabsTrigger>
            <TabsTrigger value="workflows">Workflows</TabsTrigger>
            <TabsTrigger value="downloads">下载</TabsTrigger>
          </TabsList>

          <TabsContent value="context" className="h-full overflow-auto p-6">
            {contextContent}
          </TabsContent>

          <TabsContent value="workflows" className="h-full overflow-auto p-6">
            {workflowsContent}
          </TabsContent>

          <TabsContent value="downloads" className="h-full overflow-auto p-6">
            {downloadsContent}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
