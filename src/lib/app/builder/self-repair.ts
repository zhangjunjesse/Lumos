import type { ValidationIssue } from '../manifest/types';

import type { ToolResult } from './tools/types';

/**
 * Self-repair loop logic — pure decision making about retry vs. abort.
 *
 * The agent runtime calls into this module after every generate_* /
 * validate_app result that came back as not-ok. The decision engine
 * answers two questions:
 *
 *   1. Is this kind of error "fixable" via another agent turn?
 *      (Schema violations: yes. IO errors / NotInstalled: no.)
 *   2. Have we already retried too many times for the same target?
 *      (Per ai-builder design doc §9.2: cap at 3 attempts per file.)
 *
 * Keeping this as a pure module lets the agent runtime, the test suite,
 * and the future telemetry layer share one source of truth without
 * dragging in Claude SDK / IO concerns.
 */

const FIXABLE_ERROR_CODES = new Set<string>([
  'SchemaInvalid',
  'CrossFileInvalid',
  'BadInput',
]);

const NON_FIXABLE_ERROR_CODES = new Set<string>([
  'UnknownSchema',
  'SchemaIOError',
  'IOError',
  'NotFound',
  'NotInstalled',
  'OutsideRoot',
  'BadPath',
  'IsSymlink',
  'TooLarge',
  'CorruptManifest',
  'UserCancelled',
  'ConsentDenied',
  'VersionConflict',
  'FilesystemError',
  'TopDirRejected',
  'TopFileNotAllowed',
  'TopDirNotAllowed',
]);

export const DEFAULT_MAX_ATTEMPTS = 3;

export interface RepairAttemptKey {
  /** Logical target — e.g. 'pages/main.json', 'app.json', 'validate'. */
  target: string;
  /** Tool that produced the failing result. */
  tool: string;
}

export interface RepairCounter {
  attemptsFor(key: RepairAttemptKey): number;
  recordAttempt(key: RepairAttemptKey): number;
  reset(key?: RepairAttemptKey): void;
}

export function createRepairCounter(): RepairCounter {
  const counts = new Map<string, number>();
  const k = (key: RepairAttemptKey) => `${key.tool}::${key.target}`;
  return {
    attemptsFor: (key) => counts.get(k(key)) ?? 0,
    recordAttempt: (key) => {
      const next = (counts.get(k(key)) ?? 0) + 1;
      counts.set(k(key), next);
      return next;
    },
    reset: (key) => {
      if (!key) counts.clear();
      else counts.delete(k(key));
    },
  };
}

export type RepairDecision =
  | {
      action: 'retry';
      attempt: number;
      max: number;
      issues: ValidationIssue[];
      hint?: string;
      message: string;
    }
  | {
      action: 'abort';
      reason: 'max-attempts' | 'unrecoverable';
      message: string;
      lastCode?: string;
      issues?: ValidationIssue[];
    };

export interface DecideOptions {
  maxAttempts?: number;
}

export function decideRepair(
  result: ToolResult<unknown>,
  key: RepairAttemptKey,
  counter: RepairCounter,
  opts: DecideOptions = {},
): RepairDecision | null {
  // The result was successful — nothing to repair.
  if (result.ok) return null;

  const max = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const code = result.code;

  if (NON_FIXABLE_ERROR_CODES.has(code)) {
    return {
      action: 'abort',
      reason: 'unrecoverable',
      message: result.message,
      lastCode: code,
      issues: result.issues,
    };
  }

  if (!FIXABLE_ERROR_CODES.has(code)) {
    // Unknown code: be conservative — treat as unrecoverable so we don't
    // burn LLM budget on patterns we haven't characterized. The runtime
    // surfaces the message to the user instead.
    return {
      action: 'abort',
      reason: 'unrecoverable',
      message: result.message,
      lastCode: code,
      issues: result.issues,
    };
  }

  const attempt = counter.recordAttempt(key);
  if (attempt > max) {
    return {
      action: 'abort',
      reason: 'max-attempts',
      message: `Self-repair exceeded ${max} attempts on ${key.tool} for ${key.target}; last error: ${result.message}`,
      lastCode: code,
      issues: result.issues,
    };
  }
  return {
    action: 'retry',
    attempt,
    max,
    issues: result.issues ?? [],
    hint: result.hint,
    message: result.message,
  };
}

/**
 * Render a structured "fix this" prompt the agent receives as a tool
 * result message. Keeps the issue list compact (path + message), names
 * the file, and surfaces the hint that called for a schema lookup.
 */
export function renderRepairPrompt(decision: Extract<RepairDecision, { action: 'retry' }>): string {
  const lines: string[] = [];
  lines.push(
    `Validation failed (attempt ${decision.attempt}/${decision.max}). Fix the issues below and call the same tool again with the corrected value.`,
  );
  lines.push('');
  lines.push(`Reason: ${decision.message}`);
  if (decision.hint) lines.push(`Hint: ${decision.hint}`);
  if (decision.issues.length > 0) {
    lines.push('');
    lines.push('Issues:');
    for (const i of decision.issues) {
      const where = i.jsonPath && i.jsonPath !== '/' ? ` ${i.jsonPath}` : '';
      const hint = i.hint ? ` — ${i.hint}` : '';
      lines.push(`  - [${i.level}] ${i.file}${where}: ${i.message}${hint}`);
    }
  }
  return lines.join('\n');
}
