'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CapabilityList } from '@/components/capability/CapabilityList';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface CapabilityListItem {
  id: string;
  name: string;
  description: string;
  version: string;
  status: 'draft' | 'published' | 'disabled' | 'archived';
  kind?: 'code' | 'prompt';
  category: string;
  riskLevel: 'low' | 'medium' | 'high';
}

export default function CapabilitiesPage() {
  const router = useRouter();
  const [capabilities, setCapabilities] = useState<CapabilityListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/capabilities')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !Array.isArray(data)) {
          throw new Error(data.error || 'Failed to load capabilities');
        }
        setCapabilities(data);
      })
      .catch(err => console.error('Failed to load capabilities:', err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">能力管理</h1>
            <p className="text-sm text-muted-foreground mt-1">
              管理系统能力，新增、测试和发布自定义能力
            </p>
          </div>
          <Button onClick={() => router.push('/capabilities/new')}>
            <Plus className="mr-2 h-4 w-4" />
            新增能力
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="text-center text-muted-foreground py-12">加载中...</div>
        ) : capabilities.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            暂无能力，点击"新增能力"开始创建
          </div>
        ) : (
          <CapabilityList capabilities={capabilities} />
        )}
      </div>
    </div>
  );
}
