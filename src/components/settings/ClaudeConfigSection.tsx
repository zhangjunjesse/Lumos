'use client';

import { ClaudeRuntimeCard } from './ClaudeRuntimeCard';
import { SavedConfigsCard } from './SavedConfigsCard';

export function ClaudeConfigSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">Claude 与服务商</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          在这里统一查看 Lumos 内置 Claude 运行环境，并管理可切换的服务商配置。
        </p>
      </div>
      <ClaudeRuntimeCard />
      <SavedConfigsCard />
    </div>
  );
}
