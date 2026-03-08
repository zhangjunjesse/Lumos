'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ConflictData {
  conflictingMemory: {
    id: string;
    scope: string;
    category: string;
    content: string;
  };
  newContent: string;
}

interface MemoryConflictDialogProps {
  isOpen: boolean;
  conflictData: ConflictData | null;
  onResolve: (action: 'replace' | 'keep_both' | 'cancel') => void;
}

export function MemoryConflictDialog({ isOpen, conflictData, onResolve }: MemoryConflictDialogProps) {
  if (!conflictData) return null;

  const getCategoryColor = (category: string) => {
    const colors = {
      preference: 'bg-blue-500',
      constraint: 'bg-red-500',
      fact: 'bg-green-500',
      workflow: 'bg-purple-500',
      other: 'bg-gray-500',
    };
    return colors[category as keyof typeof colors] || colors.other;
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => onResolve('cancel')}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>记忆冲突</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            检测到新记忆与现有记忆相似，请选择如何处理：
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 border border-gray-200 dark:border-gray-700 rounded">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium text-gray-500">现有记忆</span>
                <span className={`px-2 py-0.5 rounded text-xs text-white ${getCategoryColor(conflictData.conflictingMemory.category)}`}>
                  {conflictData.conflictingMemory.category}
                </span>
              </div>
              <p className="text-sm">{conflictData.conflictingMemory.content}</p>
            </div>
            <div className="p-4 border border-blue-200 dark:border-blue-700 rounded bg-blue-50 dark:bg-blue-900/20">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium text-gray-500">新记忆</span>
              </div>
              <p className="text-sm">{conflictData.newContent}</p>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onResolve('cancel')}>
              取消
            </Button>
            <Button variant="outline" onClick={() => onResolve('keep_both')}>
              保留两者
            </Button>
            <Button onClick={() => onResolve('replace')}>
              替换现有记忆
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
