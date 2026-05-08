import type Database from 'better-sqlite3';

import { NATIVE_APP_SPEC_FILE } from '../native-grade-spec';
import { getNativeSpecReview } from '../native-spec-review';
import { createSessionStore } from '../session';
import type { ConsentCallback, InstallContext } from '../../installer';

import { createGetAppStateTool } from './get-app-state';
import { createInstallAppTool } from './install-app';
import { createListCapabilitiesTool } from './list-capabilities';
import {
  generateDataSchemaTool,
  generateManifestTool,
  generatePageTool,
  generateRoutesTool,
  generateWorkflowTool,
} from './generate';
import { readSchemaTool } from './read-schema';
import type { ToolDefinition } from './types';
import { createUpdateAppFileTool } from './update-app-file';
import { validateAppTool } from './validate-app';

export interface ToolRegistryDeps {
  db: Database.Database;
  installContext: () => InstallContext;
  consentOverride?: ConsentCallback;
  builderSessionId?: string;
  capabilityFlags?: { workflowExecutionReady?: boolean; codeAppsEnabled?: boolean };
}

/**
 * Build the full set of AppBuilder tools bound to this lumos host.
 * The agent runtime layer (lands with B2) iterates the resulting array
 * to register them with Claude's tool-use protocol.
 *
 * The return type widens each tool's input/output to `unknown` because
 * tools take different shapes; the agent runtime treats them uniformly
 * via each tool's `inputSchema`. The cast at the boundary is intentional
 * — TypeScript can't prove uniformity without losing the fine-grained
 * types each tool carries for its own callers.
 */
export function buildToolRegistry(
  deps: ToolRegistryDeps,
): ToolDefinition<unknown, unknown>[] {
  const tools = [
    readSchemaTool,
    createListCapabilitiesTool(deps.db, deps.capabilityFlags ?? {}),
    generateManifestTool,
    generateRoutesTool,
    generatePageTool,
    generateWorkflowTool,
    generateDataSchemaTool,
    validateAppTool,
    createInstallAppTool({
      installContext: deps.installContext,
      consentOverride: deps.consentOverride,
      nativeSpecReview: (toolCtx) => {
        const sessionId = deps.builderSessionId ?? toolCtx.sessionId;
        if (!sessionId) return undefined;
        const store = createSessionStore(deps.db);
        const session = store.getSession(sessionId);
        if (!session) return undefined;
        const artifact = store
          .getCurrentArtifacts(sessionId)
          .find((item) => item.filePath === NATIVE_APP_SPEC_FILE);
        return {
          review: getNativeSpecReview(session.needsSummary),
          artifactVersion: artifact?.version,
        };
      },
    }),
    createUpdateAppFileTool(deps.db),
    createGetAppStateTool(deps.db),
  ];
  return tools as unknown as ToolDefinition<unknown, unknown>[];
}

export {
  generateDataSchemaTool,
  generateManifestTool,
  generatePageTool,
  generateRoutesTool,
  generateWorkflowTool,
  readSchemaTool,
  validateAppTool,
  createGetAppStateTool,
  createInstallAppTool,
  createListCapabilitiesTool,
  createUpdateAppFileTool,
};

export { resetReadSchemaCache } from './read-schema';
export { ok, err } from './types';
export type { ToolContext, ToolDefinition, ToolEvent, ToolResult } from './types';
