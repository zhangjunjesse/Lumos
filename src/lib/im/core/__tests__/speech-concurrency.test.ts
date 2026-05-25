import { mapWithConcurrency } from '../speech';

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(value), ms));
}

describe('mapWithConcurrency', () => {
  it('returns [] for an empty input without invoking the worker', async () => {
    const fn = jest.fn();
    expect(await mapWithConcurrency([], 5, fn)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('preserves input order in the output even when later tasks finish first', async () => {
    const out = await mapWithConcurrency([100, 10, 50], 3, async (ms, idx) => {
      await delay(ms, null);
      return idx;
    });
    expect(out).toEqual([0, 1, 2]);
  });

  it('caps in-flight tasks at the concurrency limit (regression: serial -> parallel for ASR)', async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 25 }, (_, i) => i);
    await mapWithConcurrency(tasks, 10, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await delay(10, null);
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(10);
    expect(peak).toBeGreaterThan(1); // must actually be parallel, not serial
  });

  it('throws the first failure, awaits the rest so cleanup is race-free', async () => {
    const settled: number[] = [];
    let thrown: unknown = null;
    try {
      await mapWithConcurrency([10, 20, 30, 40], 4, async (ms, idx) => {
        if (idx === 1) {
          await delay(5, null);
          throw new Error(`segment ${idx} failed`);
        }
        await delay(ms, null);
        settled.push(idx);
      });
    } catch (err) { thrown = err; }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('segment 1 failed');
    expect(settled).toEqual(expect.arrayContaining([0, 2, 3]));
  });

  it('clamps concurrency to items.length so we do not spawn idle workers', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3], 100, async (ms) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await delay(ms, null);
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });
});
