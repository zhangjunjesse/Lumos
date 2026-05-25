import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DATA_DIR = path.join(os.tmpdir(), `lumos-runtime-events-${process.pid}-${Date.now()}`);

beforeAll(() => {
  fs.mkdirSync(TMP_DATA_DIR, { recursive: true });
  process.env.LUMOS_DATA_DIR = TMP_DATA_DIR;
});
afterAll(() => {
  delete process.env.LUMOS_DATA_DIR;
  fs.rmSync(TMP_DATA_DIR, { recursive: true, force: true });
});

// Force a fresh module evaluation so it picks up LUMOS_DATA_DIR set above.
let recordRuntimeEvent: typeof import('../runtime-events').recordRuntimeEvent;
beforeAll(async () => {
  ({ recordRuntimeEvent } = await import('../runtime-events'));
});

const logFile = () => path.join(TMP_DATA_DIR, 'claude-runtime.log');
const readEvents = () => fs.readFileSync(logFile(), 'utf-8')
  .split('\n')
  .filter(Boolean)
  .map(line => JSON.parse(line));

describe('recordRuntimeEvent', () => {
  beforeEach(() => {
    if (fs.existsSync(logFile())) fs.unlinkSync(logFile());
  });

  it('appends one JSON-line per event with a timestamp', () => {
    recordRuntimeEvent({ event: 'session_started_fresh', sessionId: 's1', sdkSessionId: 'sdk1' });
    recordRuntimeEvent({ event: 'resume_dropped_mcp_changed', sessionId: 's1', detail: { storedSignature: 'abc' } });

    const events = readEvents();
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('session_started_fresh');
    expect(events[0].sessionId).toBe('s1');
    expect(events[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(events[1].detail).toEqual({ storedSignature: 'abc' });
  });

  it('never throws when the log directory is unwritable (best-effort guarantee)', () => {
    // Point at a path whose parent is a regular file — any open() will EACCES/ENOTDIR.
    const blocker = path.join(TMP_DATA_DIR, 'block');
    fs.writeFileSync(blocker, 'x');
    process.env.LUMOS_DATA_DIR = path.join(blocker, 'nested');
    expect(() => recordRuntimeEvent({ event: 'session_started_fresh' })).not.toThrow();
    process.env.LUMOS_DATA_DIR = TMP_DATA_DIR;
  });
});
