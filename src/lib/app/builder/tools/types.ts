import type { ValidationIssue } from '../../manifest/types';

/**
 * Common types for AppBuilder tool implementations.
 *
 * Tools are pure-ish functions the AppBuilder Claude agent calls through
 * tool-use. Each tool has a name, description, input JSON Schema (so
 * Claude knows the shape), and an `execute` function that produces a
 * structured ToolResult. The agent runtime layer (B2+) maps these to
 * Claude's tool-use protocol; here we keep them transport-agnostic so
 * they can be unit-tested directly.
 */

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: TInput, ctx: ToolContext) => Promise<ToolResult<TOutput>>;
}

export interface ToolContext {
  /** Current session id, for persistence and telemetry. */
  sessionId?: string;
  /** Logged-in user; passed through into AppRunContext for installs. */
  user?: { id: string; name?: string };
  /** Optional callback for tools that need to update session state. */
  recordEvent?: (event: ToolEvent) => void;
}

export interface ToolEvent {
  toolName: string;
  ok: boolean;
  durationMs: number;
  /** Error or summary text; never raw user input. */
  summary?: string;
}

export type ToolResult<T> =
  | { ok: true; data: T; warnings?: ValidationIssue[] }
  | {
      ok: false;
      /** Short machine-readable code, e.g. 'SchemaInvalid'. */
      code: string;
      /** Human-readable error meant for the agent to read and fix. */
      message: string;
      /** Validation issue list when relevant — agent uses this to self-repair. */
      issues?: ValidationIssue[];
      /** Helpful hint (e.g. "use read_schema('page') to inspect"). */
      hint?: string;
    };

/** Convenience constructors. */
export function ok<T>(data: T, warnings?: ValidationIssue[]): ToolResult<T> {
  return warnings && warnings.length > 0
    ? { ok: true, data, warnings }
    : { ok: true, data };
}

export function err(
  code: string,
  message: string,
  extra: { issues?: ValidationIssue[]; hint?: string } = {},
): ToolResult<never> {
  return { ok: false, code, message, ...extra };
}
