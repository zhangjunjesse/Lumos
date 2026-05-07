'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ProviderListCard } from './providers/ProviderListCard';
import { AgentDefaultCard } from './providers/AgentDefaultCard';

interface Props {
  /** When true, show providers but hide add/edit/delete controls. Used in pro
   *  edition when the admin has disabled custom chat providers — the user can
   *  still see and switch between admin-provisioned system providers. */
  readOnly?: boolean;
}

export function ChatProvidersCard({ readOnly = false }: Props) {
  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base font-semibold">AI 对话</CardTitle>
          <p className="text-sm text-muted-foreground">
            {readOnly
              ? '管理员已关闭自定义服务商。以下是当前可用的 AI 对话服务。'
              : '驱动 Lumos 聊天和工作流的 AI 服务。'}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <ProviderListCard embedded capabilityFilter="agent-chat" readOnly={readOnly} />
        </CardContent>
      </Card>

      <AgentDefaultCard />
    </div>
  );
}
