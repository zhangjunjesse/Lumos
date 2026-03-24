'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MoreVertical, Play, Pause, Archive } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface Capability {
  id: string;
  name: string;
  description: string;
  version: string;
  status: 'draft' | 'published' | 'disabled' | 'archived';
  kind?: 'code' | 'prompt';
  category: string;
  riskLevel: 'low' | 'medium' | 'high';
}

interface CapabilityListProps {
  capabilities: Capability[];
}

const statusConfig = {
  draft: { label: '待发布', color: 'bg-gray-500' },
  published: { label: '已发布', color: 'bg-green-500' },
  disabled: { label: '已停用', color: 'bg-yellow-500' },
  archived: { label: '已归档', color: 'bg-gray-400' },
};

const kindConfig = {
  code: '代码节点',
  prompt: 'Prompt 节点',
};

const riskConfig = {
  low: { label: '低风险', color: 'text-green-600' },
  medium: { label: '中风险', color: 'text-yellow-600' },
  high: { label: '高风险', color: 'text-red-600' },
};

export function CapabilityList({ capabilities }: CapabilityListProps) {
  const router = useRouter();

  if (capabilities.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        暂无能力
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {capabilities.map((capability) => (
        <Card
          key={capability.id}
          className="p-4 cursor-pointer hover:bg-accent transition-colors"
          onClick={() => router.push(`/capabilities/${capability.id}`)}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold">{capability.name}</h3>
                <Badge variant="outline" className="text-xs">
                  {capability.version}
                </Badge>
                <span className={`text-xs ${riskConfig[capability.riskLevel].color}`}>
                  {riskConfig[capability.riskLevel].label}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mb-2">
                {capability.description}
              </p>
              <div className="flex items-center gap-2">
                <Badge className={statusConfig[capability.status].color}>
                  {statusConfig[capability.status].label}
                </Badge>
                {capability.kind ? (
                  <span className="text-xs text-muted-foreground">
                    {kindConfig[capability.kind]}
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {capability.category}
                </span>
              </div>
            </div>
            <Button variant="ghost" size="icon">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
