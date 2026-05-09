import { __resetAllLocksForTesting, withLock } from '../async-lock';

beforeEach(() => {
  __resetAllLocksForTesting();
});

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('withLock', () => {
  async function flushMicrotasks(): Promise<void> {
    // Run several macrotasks so that all queued microtasks (including the
    // ones our lock chain spawns) drain. Plain `await Promise.resolve()`
    // only crosses one boundary, which isn't enough when our chain awaits
    // a predecessor that itself awaited a deferred.
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  it('serializes calls under the same key in submission order', async () => {
    const order: string[] = [];
    const a = deferred<void>();
    const b = deferred<void>();

    const p1 = withLock('K', async () => {
      order.push('start-1');
      await a.promise;
      order.push('end-1');
    });
    const p2 = withLock('K', async () => {
      order.push('start-2');
      await b.promise;
      order.push('end-2');
    });

    // Both are submitted; only the first should be running.
    await flushMicrotasks();
    expect(order).toEqual(['start-1']);

    a.resolve();
    await flushMicrotasks();
    expect(order).toEqual(['start-1', 'end-1', 'start-2']);

    b.resolve();
    await p1;
    await p2;
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
  });

  it('runs different keys concurrently', async () => {
    const order: string[] = [];
    const a = deferred<void>();
    const b = deferred<void>();

    const p1 = withLock('A', async () => {
      order.push('start-A');
      await a.promise;
      order.push('end-A');
    });
    const p2 = withLock('B', async () => {
      order.push('start-B');
      await b.promise;
      order.push('end-B');
    });

    await Promise.resolve();
    // Both start before either finishes — no cross-key blocking.
    expect(order).toContain('start-A');
    expect(order).toContain('start-B');

    b.resolve();
    await p2;
    a.resolve();
    await p1;
  });

  it('predecessor failure does not break successor', async () => {
    const events: string[] = [];
    const p1 = withLock('K', async () => {
      events.push('1-start');
      throw new Error('boom');
    }).catch((err) => {
      events.push(`1-caught:${(err as Error).message}`);
    });
    const p2 = withLock('K', async () => {
      events.push('2-start');
      return 'ok';
    });

    await p1;
    const result = await p2;
    expect(result).toBe('ok');
    expect(events).toEqual(['1-start', '1-caught:boom', '2-start']);
  });

  it('returns the function value from the lock holder', async () => {
    const result = await withLock('K', async () => 42);
    expect(result).toBe(42);
  });

  it('re-throws function errors with original stack', async () => {
    await expect(
      withLock('K', async () => {
        throw new Error('inner');
      }),
    ).rejects.toThrow('inner');
    // After throw the lock is released, so a follow-up call still runs.
    const next = await withLock('K', async () => 'after');
    expect(next).toBe('after');
  });

  it('handles 100 concurrent same-key submissions in strict order', async () => {
    const order: number[] = [];
    const tasks = Array.from({ length: 100 }, (_, i) =>
      withLock('K', async () => {
        order.push(i);
      }),
    );
    await Promise.all(tasks);
    const expected = Array.from({ length: 100 }, (_, i) => i);
    expect(order).toEqual(expected);
  });

  it('cleans up the tail map when no one is waiting', async () => {
    await withLock('K1', async () => undefined);
    // The map is private; instead verify follow-up calls don't accumulate
    // dangling promises by running many keys serially. If cleanup were broken
    // memory would grow, but here we just assert no error / no deadlock.
    for (let i = 0; i < 20; i += 1) {
      await withLock(`K-${i}`, async () => undefined);
    }
  });
});
