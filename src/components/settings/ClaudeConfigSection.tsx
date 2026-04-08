'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SavedConfigsCard } from './SavedConfigsCard';
import { ModuleOverrideSection } from './ModuleOverrideSection';

export function ClaudeConfigSection() {
  return (
    <div className="space-y-6">
      {/* Main chat providers: agent-chat capable */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base font-semibold">AI 对话</CardTitle>
          <p className="text-sm text-muted-foreground">
            驱动 Lumos 聊天和工作流的 AI 服务。
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <SavedConfigsCard embedded capabilityFilter="agent-chat" />
        </CardContent>
      </Card>

      <ModuleOverrideSection />
    </div>
  );
}
