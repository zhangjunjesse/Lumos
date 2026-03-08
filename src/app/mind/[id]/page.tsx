'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Pin, Archive, Trash2 } from 'lucide-react';
import type { MemoryRecord } from '@/lib/db/memories';

interface MemoryUsageLog {
  id: string;
  session_id: string;
  used_at: string;
  context: string;
}

export default function MemoryDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [memory, setMemory] = useState<MemoryRecord | null>(null);
  const [usageLog, setUsageLog] = useState<MemoryUsageLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/memory/${params.id}`)
      .then(r => r.json())
      .then(data => {
        setMemory(data.memory);
        setUsageLog(data.usageLog || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [params.id]);

  if (loading) return <div className="p-6">加载中...</div>;
  if (!memory) return <div className="p-6">记忆不存在</div>;

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
    <div className="h-full overflow-auto p-6">
      <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-4">
        <ArrowLeft className="w-4 h-4 mr-2" />
        返回
      </Button>

      <div className="max-w-3xl mx-auto space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded text-sm text-white ${getCategoryColor(memory.category)}`}>
                {memory.category}
              </span>
              <span className="px-3 py-1 rounded text-sm bg-gray-100 dark:bg-gray-700">
                {memory.scope}
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm">
                <Pin className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm">
                <Archive className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <p className="text-lg mb-4">{memory.content}</p>
          <div className="text-sm text-gray-500 space-y-1">
            <p>创建时间：{memory.created_at}</p>
            <p>使用次数：{memory.hit_count}</p>
            {memory.last_used_at && <p>最后使用：{memory.last_used_at}</p>}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border p-6">
          <h3 className="font-medium mb-4">使用时间线</h3>
          {usageLog.length === 0 ? (
            <p className="text-sm text-gray-500">暂无使用记录</p>
          ) : (
            <div className="space-y-3">
              {usageLog.map(log => (
                <div key={log.id} className="flex gap-3 text-sm">
                  <span className="text-gray-500">{log.used_at}</span>
                  <span className="flex-1 text-gray-700 dark:text-gray-300">{log.context || '无上下文'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
