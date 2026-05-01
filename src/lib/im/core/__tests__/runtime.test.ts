const store = new Map<string, string>();
jest.mock('@/lib/db', () => ({
  getSetting: (key: string) => store.get(key),
  setSetting: (key: string, value: string) => {
    store.set(key, value);
  },
}));

import {
  getOrCreateAdapter,
  startAdapter,
  stopAdapter,
  restartAdapter,
  startAllEnabled,
  stopAll,
  getActiveAdapter,
  listActiveAdapters,
  sendToProvider,
  sendToDefault,
  __resetRuntimeForTesting,
} from '../runtime';
import { registerPlugin, __resetRegistryForTesting } from '../registry';
import {
  setProviderField,
  setProviderEnabled,
  setDefaultProviderId,
} from '../config-store';
import type {
  IMPlugin,
  IMAdapter,
  OutboundMessage,
  ChannelAddress,
  SendResult,
  ProbeResult,
  InboundMessage,
} from '../types';

class FakeAdapter implements IMAdapter {
  readonly id: string;
  private running = false;
  startCalls = 0;
  stopCalls = 0;
  sentMessages: OutboundMessage[] = [];

  constructor(id: string, private readonly cfg: Record<string, unknown>) {
    this.id = id;
  }
  async start() {
    this.startCalls += 1;
    this.running = true;
  }
  async stop() {
    this.stopCalls += 1;
    this.running = false;
  }
  isRunning() {
    return this.running;
  }
  async consumeOne(): Promise<InboundMessage | null> {
    return null;
  }
  async send(message: OutboundMessage): Promise<SendResult> {
    this.sentMessages.push(message);
    return { ok: true, messageId: `${this.id}-${this.sentMessages.length}` };
  }
  async probe(): Promise<ProbeResult> {
    return { ok: true };
  }
  validateConfig(): string | null {
    return this.cfg.host ? null : 'host required';
  }
}

const fakePlugin: IMPlugin = {
  manifest: {
    id: 'fake',
    label: 'Fake',
    description: 'test',
    configSchema: [
      { key: 'host', label: 'Host', type: 'url', required: true, default: 'http://localhost' },
    ],
    capabilities: {
      chatTypes: ['direct'],
      media: false,
      reactions: false,
      threads: false,
      edit: false,
      commands: false,
      targetDirectory: false,
      streamingPreview: false,
    },
  },
  createAdapter: (cfg) => new FakeAdapter('fake', cfg),
};

const otherPlugin: IMPlugin = {
  manifest: {
    id: 'other',
    label: 'Other',
    description: 'test',
    configSchema: [
      { key: 'host', label: 'Host', type: 'url', required: true, default: 'http://localhost' },
    ],
    capabilities: {
      chatTypes: ['direct'],
      media: false,
      reactions: false,
      threads: false,
      edit: false,
      commands: false,
      targetDirectory: false,
      streamingPreview: false,
    },
  },
  createAdapter: (cfg) => new FakeAdapter('other', cfg),
};

const addr = (providerId: string): ChannelAddress => ({ providerId, chatId: 'c1' });

beforeEach(() => {
  store.clear();
  __resetRegistryForTesting();
  __resetRuntimeForTesting();
  registerPlugin(fakePlugin);
  registerPlugin(otherPlugin);
});

describe('im/core/runtime: lifecycle', () => {
  test('getOrCreateAdapter returns same instance', () => {
    const a = getOrCreateAdapter('fake');
    const b = getOrCreateAdapter('fake');
    expect(a).toBe(b);
  });

  test('startAdapter is idempotent', async () => {
    await startAdapter('fake');
    await startAdapter('fake');
    const adapter = getOrCreateAdapter('fake') as FakeAdapter;
    expect(adapter.startCalls).toBe(1);
    expect(adapter.isRunning()).toBe(true);
  });

  test('stopAdapter clears cache and stops', async () => {
    await startAdapter('fake');
    const adapter = getOrCreateAdapter('fake') as FakeAdapter;
    await stopAdapter('fake');
    expect(adapter.stopCalls).toBe(1);
    expect(getActiveAdapter('fake')).toBeNull();
  });

  test('restartAdapter cycles', async () => {
    await startAdapter('fake');
    await restartAdapter('fake');
    expect(getActiveAdapter('fake')).not.toBeNull();
  });

  test('throws for unknown provider', () => {
    expect(() => getOrCreateAdapter('ghost')).toThrow(/unknown provider/);
  });
});

describe('im/core/runtime: bulk start', () => {
  test('startAllEnabled only starts enabled+configured', async () => {
    setProviderField('fake', 'host', 'http://x');
    setProviderEnabled('fake', true);
    // 'other' is configured by default (host has a default), but not enabled
    setProviderField('other', 'host', 'http://x');

    await startAllEnabled();

    const active = listActiveAdapters().map((a) => a.id).sort();
    expect(active).toEqual(['fake']);
  });

  test('stopAll stops everything', async () => {
    setProviderField('fake', 'host', 'http://x');
    setProviderEnabled('fake', true);
    await startAllEnabled();
    expect(listActiveAdapters()).toHaveLength(1);

    await stopAll();
    expect(listActiveAdapters()).toHaveLength(0);
  });
});

describe('im/core/runtime: outbound', () => {
  test('sendToProvider auto-starts and delivers', async () => {
    const result = await sendToProvider('fake', { address: addr('fake'), text: 'hi' });
    expect(result.ok).toBe(true);
    const adapter = getOrCreateAdapter('fake') as FakeAdapter;
    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0].text).toBe('hi');
  });

  test('sendToDefault errors when no default', async () => {
    const result = await sendToDefault({ address: addr('fake'), text: 'hi' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no default/);
  });

  test('sendToDefault routes via default provider', async () => {
    setDefaultProviderId('fake');
    const result = await sendToDefault({ address: addr('fake'), text: 'hi' });
    expect(result.ok).toBe(true);
  });

  test('sendToDefault rejects mismatched address.providerId', async () => {
    setDefaultProviderId('fake');
    const result = await sendToDefault({ address: addr('other'), text: 'hi' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/does not match default/);
  });
});
