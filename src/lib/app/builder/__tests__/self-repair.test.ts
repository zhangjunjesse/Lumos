import {
  DEFAULT_MAX_ATTEMPTS,
  createRepairCounter,
  decideRepair,
  renderRepairPrompt,
} from '../self-repair';
import type { ToolResult } from '../tools/types';

describe('createRepairCounter', () => {
  it('counts attempts per (tool, target) key independently', () => {
    const c = createRepairCounter();
    const a = { tool: 'generate_page', target: 'pages/main.json' };
    const b = { tool: 'generate_page', target: 'pages/other.json' };
    c.recordAttempt(a);
    c.recordAttempt(a);
    c.recordAttempt(b);
    expect(c.attemptsFor(a)).toBe(2);
    expect(c.attemptsFor(b)).toBe(1);
  });

  it('reset() clears specific or all keys', () => {
    const c = createRepairCounter();
    const a = { tool: 'a', target: 'x' };
    const b = { tool: 'b', target: 'y' };
    c.recordAttempt(a);
    c.recordAttempt(b);
    c.reset(a);
    expect(c.attemptsFor(a)).toBe(0);
    expect(c.attemptsFor(b)).toBe(1);
    c.reset();
    expect(c.attemptsFor(b)).toBe(0);
  });
});

describe('decideRepair', () => {
  const successResult: ToolResult<unknown> = { ok: true, data: null };
  const key = { tool: 'generate_page', target: 'pages/main.json' };

  function fail(code: string, opts: { message?: string } = {}): ToolResult<unknown> {
    return {
      ok: false,
      code,
      message: opts.message ?? `${code} happened`,
      issues: [
        { level: 'error', file: 'pages/main.json', jsonPath: '/layout', message: 'enum mismatch' },
      ],
    };
  }

  it('returns null for successful results', () => {
    expect(decideRepair(successResult, key, createRepairCounter())).toBeNull();
  });

  it('retries fixable codes up to DEFAULT_MAX_ATTEMPTS', () => {
    const c = createRepairCounter();
    const r1 = decideRepair(fail('SchemaInvalid'), key, c);
    const r2 = decideRepair(fail('SchemaInvalid'), key, c);
    const r3 = decideRepair(fail('SchemaInvalid'), key, c);
    const r4 = decideRepair(fail('SchemaInvalid'), key, c);
    expect(r1?.action).toBe('retry');
    expect(r2?.action).toBe('retry');
    expect(r3?.action).toBe('retry');
    expect(r4?.action).toBe('abort');
    if (r3?.action !== 'retry') return;
    expect(r3.attempt).toBe(3);
    expect(r3.max).toBe(DEFAULT_MAX_ATTEMPTS);
    if (r4?.action !== 'abort') return;
    expect(r4.reason).toBe('max-attempts');
  });

  it('respects a custom max', () => {
    const c = createRepairCounter();
    const r1 = decideRepair(fail('SchemaInvalid'), key, c, { maxAttempts: 1 });
    const r2 = decideRepair(fail('SchemaInvalid'), key, c, { maxAttempts: 1 });
    expect(r1?.action).toBe('retry');
    expect(r2?.action).toBe('abort');
  });

  it('treats CrossFileInvalid and BadInput as fixable', () => {
    expect(
      decideRepair(fail('CrossFileInvalid'), key, createRepairCounter())?.action,
    ).toBe('retry');
    expect(
      decideRepair(fail('BadInput'), key, createRepairCounter())?.action,
    ).toBe('retry');
  });

  it('treats IO and policy errors as unrecoverable', () => {
    for (const code of [
      'IOError',
      'NotFound',
      'NotInstalled',
      'OutsideRoot',
      'IsSymlink',
      'TooLarge',
      'CorruptManifest',
      'UserCancelled',
      'VersionConflict',
      'TopDirRejected',
    ]) {
      const r = decideRepair(fail(code), key, createRepairCounter());
      expect(r?.action).toBe('abort');
      if (r?.action !== 'abort') continue;
      expect(r.reason).toBe('unrecoverable');
    }
  });

  it('treats unknown codes conservatively as unrecoverable', () => {
    const r = decideRepair(fail('SomethingNew'), key, createRepairCounter());
    expect(r?.action).toBe('abort');
    if (r?.action !== 'abort') return;
    expect(r.reason).toBe('unrecoverable');
  });
});

describe('renderRepairPrompt', () => {
  it('produces a structured retry message with attempt counter and issues', () => {
    const c = createRepairCounter();
    const result: ToolResult<unknown> = {
      ok: false,
      code: 'SchemaInvalid',
      message: 'pages/main.json failed schema validation',
      hint: "Call read_schema('page') for full constraints.",
      issues: [
        {
          level: 'error',
          file: 'pages/main.json',
          jsonPath: '/layout',
          message: 'must be one of single, form, list-detail, result',
        },
        {
          level: 'error',
          file: 'pages/main.json',
          jsonPath: '/blocks',
          message: 'required',
        },
      ],
    };
    const decision = decideRepair(result, { tool: 'generate_page', target: 'pages/main.json' }, c);
    if (decision?.action !== 'retry') throw new Error('precondition');
    const prompt = renderRepairPrompt(decision);
    expect(prompt).toContain('attempt 1/3');
    expect(prompt).toContain("Call read_schema('page')");
    expect(prompt).toContain('/layout');
    expect(prompt).toContain('/blocks');
  });
});
