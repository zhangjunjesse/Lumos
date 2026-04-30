// Mock @/lib/im before importing the route handler so we can drive the dispatch
// table deterministically without needing real DB / network.
const fakeProviders = [
  {
    manifest: {
      id: 'feishu',
      label: 'Feishu',
      description: '',
      configSchema: [],
      capabilities: {
        chatTypes: ['direct', 'group'],
        media: false,
        reactions: false,
        threads: false,
        edit: false,
        commands: false,
        targetDirectory: true,
        streamingPreview: false,
      },
    },
    createAdapter: () => ({} as never),
  },
];

const adapter = {
  listTargets: jest.fn(async () => [{ id: 'oc_a', name: 'Alice', kind: 'direct' as const }]),
};

jest.mock('@/lib/im', () => ({
  listPlugins: () => fakeProviders,
  getPlugin: (id: string) => fakeProviders.find((p) => p.manifest.id === id) || null,
  isProviderConfigured: () => true,
  isProviderEnabled: () => true,
  getDefaultProviderId: () => 'feishu',
  getOrCreateAdapter: () => adapter,
  hasProvider: (id: string) => id === 'feishu',
  hasTargetDirectory: () => true,
  sendToProvider: jest.fn(async () => ({ ok: true, messageId: 'mid-1' })),
  sendToDefault: jest.fn(async () => ({ ok: true, messageId: 'mid-default' })),
}));

import { POST } from '../route';

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/im/tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/im/tool', () => {
  test('rejects missing action', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  test('im_list_providers returns providers + default id', async () => {
    const res = await POST(makeRequest({ action: 'im_list_providers' }));
    const data = await res.json();
    expect(data.providers).toHaveLength(1);
    expect(data.providers[0].id).toBe('feishu');
    expect(data.defaultProviderId).toBe('feishu');
  });

  test('im_default_provider returns id', async () => {
    const res = await POST(makeRequest({ action: 'im_default_provider' }));
    const data = await res.json();
    expect(data.providerId).toBe('feishu');
  });

  test('im_list_targets calls adapter.listTargets', async () => {
    const res = await POST(makeRequest({ action: 'im_list_targets', providerId: 'feishu', query: 'al' }));
    const data = await res.json();
    expect(data.targets).toHaveLength(1);
    expect(data.targets[0].name).toBe('Alice');
    expect(adapter.listTargets).toHaveBeenCalledWith({ query: 'al', limit: undefined });
  });

  test('im_list_targets requires providerId', async () => {
    const res = await POST(makeRequest({ action: 'im_list_targets' }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toMatch(/providerId/);
  });

  test('im_send delivers via sendToProvider', async () => {
    const res = await POST(makeRequest({
      action: 'im_send',
      providerId: 'feishu',
      chatId: 'oc_a',
      text: 'hello',
    }));
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.messageId).toBe('mid-1');
    const mod = jest.requireMock('@/lib/im') as { sendToProvider: jest.Mock };
    expect(mod.sendToProvider).toHaveBeenCalledWith('feishu', expect.objectContaining({
      address: { providerId: 'feishu', chatId: 'oc_a' },
      text: 'hello',
    }));
  });

  test('im_send rejects unknown provider', async () => {
    const res = await POST(makeRequest({
      action: 'im_send',
      providerId: 'ghost',
      chatId: 'x',
      text: 'y',
    }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toMatch(/unknown provider/);
  });

  test('im_send_to_default calls sendToDefault', async () => {
    const res = await POST(makeRequest({
      action: 'im_send_to_default',
      chatId: 'oc_a',
      text: 'hi',
    }));
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.messageId).toBe('mid-default');
  });

  test('unknown action returns 400', async () => {
    const res = await POST(makeRequest({ action: 'im_blow_up' }));
    expect(res.status).toBe(400);
  });
});
