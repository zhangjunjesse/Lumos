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

// We control the sandbox check from the mock so tests work in /tmp without
// having to actually create .lumos-uploads / etc.
let sandboxResolver: ((p: string) => string | null) = () => null;

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
  resolveLumosSandboxPath: (p: string) => sandboxResolver(p),
  mimeFromPath: (p: string) =>
    p.endsWith('.png') ? 'image/png'
      : p.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'application/octet-stream',
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

  describe('im_send_attachment', () => {
    let tmpDir: string;
    let docPath: string;
    let docBytes: Buffer;

    beforeAll(() => {
      const fs = jest.requireActual('node:fs') as typeof import('node:fs');
      const os = jest.requireActual('node:os') as typeof import('node:os');
      const path = jest.requireActual('node:path') as typeof import('node:path');
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-tool-test-'));
      docPath = path.join(tmpDir, 'report.docx');
      docBytes = Buffer.from('PK\x03\x04 fake docx');
      fs.writeFileSync(docPath, docBytes);
      sandboxResolver = (p: string) => (p === docPath ? docPath : null);
    });

    afterAll(() => {
      const fs = jest.requireActual('node:fs') as typeof import('node:fs');
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      sandboxResolver = () => null;
    });

    test('rejects path outside sandbox', async () => {
      const res = await POST(makeRequest({
        action: 'im_send_attachment',
        providerId: 'feishu',
        chatId: 'oc_a',
        filePath: '/etc/passwd',
      }));
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toMatch(/not allowed/);
    });

    test('reads sandbox file and forwards as IMFileAttachment', async () => {
      const mod = jest.requireMock('@/lib/im') as { sendToProvider: jest.Mock };
      mod.sendToProvider.mockClear();

      const res = await POST(makeRequest({
        action: 'im_send_attachment',
        providerId: 'feishu',
        chatId: 'oc_a',
        filePath: docPath,
        text: 'here you go',
      }));
      expect(res.status).toBe(200);
      expect(mod.sendToProvider).toHaveBeenCalledTimes(1);
      const [providerArg, msgArg] = mod.sendToProvider.mock.calls[0];
      expect(providerArg).toBe('feishu');
      expect(msgArg.text).toBe('here you go');
      expect(msgArg.attachments).toHaveLength(1);
      expect(msgArg.attachments[0].name).toBe('report.docx');
      expect(msgArg.attachments[0].type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(msgArg.attachments[0].size).toBe(docBytes.length);
      expect(msgArg.attachments[0].data).toBe(docBytes.toString('base64'));
    });

    test('rejects missing required fields', async () => {
      const res = await POST(makeRequest({
        action: 'im_send_attachment',
        providerId: 'feishu',
        // chatId / filePath missing
      }));
      expect(res.status).toBe(500);
      expect((await res.json()).error).toMatch(/required/);
    });

    test('im_send_to_default_attachment uses default provider', async () => {
      const mod = jest.requireMock('@/lib/im') as { sendToDefault: jest.Mock };
      mod.sendToDefault.mockClear();

      const res = await POST(makeRequest({
        action: 'im_send_to_default_attachment',
        chatId: 'oc_a',
        filePath: docPath,
        fileName: '季度报告.docx',
      }));
      expect(res.status).toBe(200);
      expect(mod.sendToDefault).toHaveBeenCalledTimes(1);
      const arg = mod.sendToDefault.mock.calls[0][0];
      expect(arg.address.providerId).toBe('feishu'); // default
      expect(arg.attachments[0].name).toBe('季度报告.docx');
    });
  });
});
