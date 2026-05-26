import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DATA_DIR = path.join(os.tmpdir(), `lumos-llm-debug-${process.pid}-${Date.now()}`);

beforeAll(() => {
  fs.mkdirSync(TMP_DATA_DIR, { recursive: true });
  process.env.LUMOS_DATA_DIR = TMP_DATA_DIR;
});
afterAll(() => {
  delete process.env.LUMOS_DATA_DIR;
  fs.rmSync(TMP_DATA_DIR, { recursive: true, force: true });
});

let extractContextAroundError: typeof import('../llm-debug-logger').extractContextAroundError;
let recordLlmDebug: typeof import('../llm-debug-logger').recordLlmDebug;
beforeAll(async () => {
  ({ extractContextAroundError, recordLlmDebug } = await import('../llm-debug-logger'));
});

const logFile = () => path.join(TMP_DATA_DIR, 'llm-debug.log');
const readLines = () => fs.readFileSync(logFile(), 'utf-8')
  .split('\n').filter(Boolean).map(line => JSON.parse(line));

beforeEach(() => {
  if (fs.existsSync(logFile())) fs.unlinkSync(logFile());
});

describe('recordLlmDebug', () => {
  it('writes one JSON line per call with timestamp and stage', () => {
    recordLlmDebug({ requestId: 'r1', stage: 'request_started', providerId: 'p', model: 'm' });
    recordLlmDebug({ requestId: 'r1', stage: 'json_parse_failed', detail: { extractedLength: 800 } });
    const lines = readLines();
    expect(lines).toHaveLength(2);
    expect(lines[0].stage).toBe('request_started');
    expect(lines[0].requestId).toBe('r1');
    expect(lines[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(lines[1].detail).toEqual({ extractedLength: 800 });
  });

  it('clips oversized string fields so a huge LLM blob does not bloat the log line', () => {
    const huge = 'a'.repeat(200_000);
    recordLlmDebug({
      requestId: 'r2',
      stage: 'json_parse_failed',
      detail: { rawText: huge, smallField: 'kept' },
    });
    const [line] = readLines();
    const rawText = line.detail.rawText as string;
    // Clipped to ~128 KB plus a "[+N chars]" marker.
    expect(rawText.length).toBeLessThan(huge.length);
    expect(rawText).toMatch(/\[\+\d+ chars\]$/);
    expect(line.detail.smallField).toBe('kept');
  });

  it('never throws when the log dir is unwritable (best-effort guarantee)', () => {
    const blocker = path.join(TMP_DATA_DIR, 'block-file');
    fs.writeFileSync(blocker, 'x');
    process.env.LUMOS_DATA_DIR = path.join(blocker, 'nested');
    expect(() => recordLlmDebug({ requestId: 'r3', stage: 'request_started' })).not.toThrow();
    process.env.LUMOS_DATA_DIR = TMP_DATA_DIR;
  });
});

describe('extractContextAroundError', () => {
  it('returns undefined for non-Error or messages without a position marker', () => {
    expect(extractContextAroundError('{"a":1}', 'not an error')).toBeUndefined();
    expect(extractContextAroundError('{"a":1}', new Error('no position here'))).toBeUndefined();
  });

  it('extracts ±200 chars around the failing column with a caret marker', () => {
    const json = `${'x'.repeat(300)}BAD${'y'.repeat(300)}`;
    const err = new Error('Expected , or } after property value in JSON at position 300 (line 1 column 301)');
    const ctx = extractContextAroundError(json, err)!;
    expect(ctx).toContain('BAD');                 // the failing region itself
    expect(ctx).toContain('xxx');                 // leading context
    expect(ctx).toContain('yyy');                 // trailing context
    expect(ctx).toContain('^^^ ERROR HERE');      // human-readable caret
    expect(ctx).toContain('position 300');
  });

  it('handles errors near the start of the string without underflow', () => {
    const err = new Error('Unexpected token at position 2');
    const ctx = extractContextAroundError('{ab}', err)!;
    expect(ctx).toMatch(/\^\^\^ ERROR HERE/);
    expect(ctx).toContain('position 2');
  });
});
