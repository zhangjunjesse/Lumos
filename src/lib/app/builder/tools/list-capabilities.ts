import type Database from 'better-sqlite3';

import {
  type AvailableCapabilities,
  probeCapabilities,
} from '../capabilities';

import { type ToolDefinition, ok } from './types';

/**
 * Tool: list_capabilities()
 *
 * Returns the live capability snapshot for the AppBuilder agent — same
 * shape as the system-prompt's "Current capabilities" section, just
 * machine-readable so the agent can iterate and pick concretely.
 *
 * Caller wires the database in at session startup; the tool itself is
 * a thin wrapper around probeCapabilities.
 */

export type ListCapabilitiesOutput = AvailableCapabilities;

export function createListCapabilitiesTool(
  db: Database.Database,
  opts: { workflowExecutionReady?: boolean; codeAppsEnabled?: boolean } = {},
): ToolDefinition<Record<string, never>, ListCapabilitiesOutput> {
  return {
    name: 'list_capabilities',
    description:
      'Return the current set of MCP servers, agents, knowledge collections, native integrations, LLM tiers, and tools available on this Lumos host. Always refer to this list when proposing manifest.requires fields — never invent capabilities.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    async execute() {
      return ok(probeCapabilities(db, opts));
    },
  };
}
