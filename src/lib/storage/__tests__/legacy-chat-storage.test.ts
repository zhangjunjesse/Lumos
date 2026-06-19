import { purgeLegacyChatStorage } from '../legacy-chat-storage';

type Store = Record<string, string>;

function installLocalStorage(initial: Store): Store {
  const store: Store = { ...initial };
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    },
  };
  return store;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('purgeLegacyChatStorage', () => {
  it('drops orphaned persist-store keys regardless of size', () => {
    const store = installLocalStorage({
      'lumos-messages-store': 'x',
      'lumos-streaming-store': 'y',
      'unrelated-key': 'keep',
    });

    purgeLegacyChatStorage();

    expect('lumos-messages-store' in store).toBe(false);
    expect('lumos-streaming-store' in store).toBe(false);
    expect(store['unrelated-key']).toBe('keep');
  });

  it('drops an oversized etsy-erank-chat-model value', () => {
    const store = installLocalStorage({
      'etsy-erank-chat-model': 'a'.repeat(512 * 1024 + 1),
    });

    purgeLegacyChatStorage();

    expect('etsy-erank-chat-model' in store).toBe(false);
  });

  it('keeps a normal-sized etsy-erank-chat-model value (a model id)', () => {
    const store = installLocalStorage({
      'etsy-erank-chat-model': 'claude-sonnet-4-6',
    });

    purgeLegacyChatStorage();

    expect(store['etsy-erank-chat-model']).toBe('claude-sonnet-4-6');
  });

  it('is a no-op (and does not throw) when window is undefined (SSR)', () => {
    expect(() => purgeLegacyChatStorage()).not.toThrow();
  });

  it('swallows localStorage errors so startup is never blocked', () => {
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: () => {
          throw new Error('boom');
        },
        setItem: () => undefined,
        removeItem: () => {
          throw new Error('boom');
        },
      },
    };

    expect(() => purgeLegacyChatStorage()).not.toThrow();
  });
});
