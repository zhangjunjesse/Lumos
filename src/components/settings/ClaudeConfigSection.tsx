'use client';

import { ConfigListCard } from './ConfigListCard';
import { ApiKeyManagementCard } from './ApiKeyManagementCard';

export function ClaudeConfigSection() {
  return (
    <div className="space-y-6">
      <ConfigListCard />
      <ApiKeyManagementCard />
    </div>
  );
}
