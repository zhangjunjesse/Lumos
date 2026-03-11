'use client';

import { CurrentConfigCard } from './CurrentConfigCard';
import { ApiKeyManagementCard } from './ApiKeyManagementCard';
import { SavedConfigsCard } from './SavedConfigsCard';

export function ClaudeConfigSection() {
  return (
    <div className="space-y-6">
      <CurrentConfigCard />
      <ApiKeyManagementCard />
      <SavedConfigsCard />
    </div>
  );
}
