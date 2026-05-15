import path from 'path';
import type { MCPServerConfig } from '@/types';
import { resolveRuntimeResourcePath } from '@/lib/runtime-resources';

function isNodeCommand(command: string | undefined): boolean {
  const normalized = (command || '').trim();
  if (!normalized) return false;
  const base = path.basename(normalized).toLowerCase();
  return base === 'node' || base === 'node.exe';
}

export function resolveMcpRuntimeCommand(config: Pick<MCPServerConfig, 'command' | 'runtime'>): string {
  const command = (config.command || '').trim();
  if (!command) return command;

  if ((config.runtime === 'node' || isNodeCommand(command)) && isNodeCommand(command) && !path.isAbsolute(command)) {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const bundledNode = resolveRuntimeResourcePath(path.join('node-runtime', process.platform, process.arch, `node${ext}`));
    if (bundledNode) return bundledNode;
  }

  return command;
}
