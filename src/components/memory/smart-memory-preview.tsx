'use client';

import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

interface PreviewMemory {
  content: string;
  category: string;
  scope: string;
  evidence: string;
}

interface SmartMemoryPreviewProps {
  memories: PreviewMemory[];
  onConfirm: (memory: PreviewMemory) => void;
  onEdit: (memory: PreviewMemory, newContent: string) => void;
  onDismiss: () => void;
}

export function SmartMemoryPreview({ memories, onConfirm, onEdit, onDismiss }: SmartMemoryPreviewProps) {
  if (memories.length === 0) return null;

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
    <div className="fixed bottom-20 right-6 w-96 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🤖</span>
          <span className="font-medium text-sm">AI发现了可能值得记住的内容</span>
        </div>
        <button onClick={onDismiss} className="text-gray-400 hover:text-gray-600">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="space-y-3">
        {memories.map((memory, idx) => (
          <div key={idx} className="p-3 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 mb-2">
              <span className={`px-2 py-0.5 rounded text-xs text-white ${getCategoryColor(memory.category)}`}>
                {memory.category}
              </span>
            </div>
            <p className="text-sm mb-2">{memory.content}</p>
            <p className="text-xs text-gray-500 mb-3">证据：{memory.evidence}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => onDismiss()}>
                忽略
              </Button>
              <Button size="sm" onClick={() => onConfirm(memory)}>
                确认保存
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
