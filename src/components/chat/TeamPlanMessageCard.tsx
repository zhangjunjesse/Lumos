'use client';

import { Card } from '@/components/ui/card';

interface TeamPlanMessageCardProps {
  messageId: string;
  sessionId: string;
  plan: any;
  compact?: boolean;
}

export function TeamPlanMessageCard({ plan }: TeamPlanMessageCardProps) {
  return (
    <Card className="p-4">
      <pre className="text-xs overflow-auto">{JSON.stringify(plan, null, 2)}</pre>
    </Card>
  );
}
