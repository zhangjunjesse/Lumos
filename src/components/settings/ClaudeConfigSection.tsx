'use client';

import { CurrentConfigCard } from './CurrentConfigCard';
import { ApiKeyManagementCard } from './ApiKeyManagementCard';

export function ClaudeConfigSection() {
  return (
    <div className="space-y-6">
      <CurrentConfigCard />
      <ApiKeyManagementCard />
    </div>
  );
}
