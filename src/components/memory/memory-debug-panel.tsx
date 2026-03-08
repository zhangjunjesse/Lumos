'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface DebugPanelProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId?: string;
}

export function MemoryDebugPanel({ isOpen, onClose, sessionId }: DebugPanelProps) {
  const [contextData, setContextData] = useState<any>(null);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>记忆系统调试面板</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="context">
          <TabsList>
            <TabsTrigger value="context">Context</TabsTrigger>
            <TabsTrigger value="retrieval">Retrieval</TabsTrigger>
            <TabsTrigger value="injection">Injection</TabsTrigger>
          </TabsList>
          <TabsContent value="context" className="space-y-3">
            <p className="text-sm text-gray-500">当前会话注入的记忆上下文</p>
            <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded text-sm font-mono">
              {contextData ? JSON.stringify(contextData, null, 2) : '暂无数据'}
            </div>
          </TabsContent>
          <TabsContent value="retrieval" className="space-y-3">
            <p className="text-sm text-gray-500">记忆检索算法评分详情</p>
            <div className="text-sm">评分规则：置顶+120、项目+12、关键词匹配+8-16、时效性+0-20</div>
          </TabsContent>
          <TabsContent value="injection" className="space-y-3">
            <p className="text-sm text-gray-500">记忆注入到prompt的位置</p>
            <div className="text-sm">记忆通过&lt;lumos_memory&gt;标签注入到用户prompt之前</div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
