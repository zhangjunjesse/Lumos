'use client';

import Link from 'next/link';
import { Pin, Archive, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getCategoryLabel, getScopeLabel, getCategoryIcon } from '@/lib/memory-labels';

interface Memory {
  id: string;
  content: string;
  category: string;
  scope: string;
  hitCount: number;
  isPinned?: boolean;
  lastUsedAt: string | null;
  updatedAt: string;
}

interface MemoryGridProps {
  memories: Memory[];
  onPin: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
}

export function MemoryGrid({ memories, onPin, onArchive, onDelete }: MemoryGridProps) {
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
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {memories.map((memory) => (
        <div key={memory.id} className="bg-white dark:bg-gray-800 rounded-lg border p-4 hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-xs text-white ${getCategoryColor(memory.category)}`}>
                {getCategoryIcon(memory.category)} {getCategoryLabel(memory.category)}
              </span>
              <span className="px-2 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-700">
                {getScopeLabel(memory.scope)}
              </span>
            </div>
            {memory.isPinned && <Pin className="w-4 h-4 text-blue-500" />}
          </div>
          <Link href={`/mind/${memory.id}`}>
            <p className="text-sm mb-3 line-clamp-3 hover:text-blue-500 cursor-pointer">{memory.content}</p>
          </Link>
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>使用 {memory.hitCount} 次</span>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => onPin(memory.id)}>
                <Pin className="w-3 h-3" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onArchive(memory.id)}>
                <Archive className="w-3 h-3" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onDelete(memory.id)}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
