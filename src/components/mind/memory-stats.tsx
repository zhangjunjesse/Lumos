'use client';

import { getCategoryLabel, getScopeLabel } from '@/lib/memory-labels';

interface MemoryStatsProps {
  total: number;
  byCategory: Record<string, number>;
  byScope: Record<string, number>;
  totalUsage: number;
}

export function MemoryStats({ total, byCategory, byScope, totalUsage }: MemoryStatsProps) {
  return (
    <div className="grid grid-cols-4 gap-4 mb-6">
      <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
        <div className="text-sm text-gray-500 mb-1">总记忆数</div>
        <div className="text-2xl font-bold">{total}</div>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
        <div className="text-sm text-gray-500 mb-1">使用次数</div>
        <div className="text-2xl font-bold">{totalUsage}</div>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
        <div className="text-sm text-gray-500 mb-1">类别分布</div>
        <div className="text-sm space-y-1">
          {Object.entries(byCategory).map(([cat, count]) => (
            <div key={cat} className="flex justify-between">
              <span>{getCategoryLabel(cat)}</span>
              <span className="font-medium">{count}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
        <div className="text-sm text-gray-500 mb-1">作用域分布</div>
        <div className="text-sm space-y-1">
          {Object.entries(byScope).map(([scope, count]) => (
            <div key={scope} className="flex justify-between">
              <span>{getScopeLabel(scope)}</span>
              <span className="font-medium">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
