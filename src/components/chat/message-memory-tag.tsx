'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { MemoryRecord } from '@/lib/db/memories';

interface MessageMemoryTagProps {
  messageId: string;
}

export function MessageMemoryTag({ messageId }: MessageMemoryTagProps) {
  const [memories, setMemories] = useState<Array<MemoryRecord & { relation_type: string }>>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/messages/${messageId}/memories`)
      .then(r => r.json())
      .then(data => {
        setMemories(data.memories || []);
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, [messageId]);

  if (isLoading || memories.length === 0) return null;

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
    <div className="mt-2 border-t border-gray-200 dark:border-gray-700 pt-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
      >
        {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">
          {memories.length} 条记忆
        </span>
      </button>
      {isExpanded && (
        <div className="mt-2 space-y-1">
          {memories.map(memory => (
            <div key={memory.id} className="flex items-start gap-2 text-xs p-2 bg-gray-50 dark:bg-gray-800 rounded">
              <span className={`px-1.5 py-0.5 rounded text-white ${getCategoryColor(memory.category)}`}>
                {memory.category}
              </span>
              <span className="flex-1 text-gray-700 dark:text-gray-300 line-clamp-2">{memory.content}</span>
              <span className="text-gray-500">{memory.relation_type === 'created' ? '创建' : '使用'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
