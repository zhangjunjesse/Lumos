// Mock the heavy dependencies before importing the route module so the
// resolver / app platform service never need a real DB.
import type { ApiProvider } from '@/types';

const fakeStore = {
  count: jest.fn(),
  query: jest.fn(),
  get: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

jest.mock('@/lib/app/service', () => ({
  getAppPlatformService: () => ({
    db: {
      prepare: () => ({
        get: () => ({ version: '0.1.0' }),
      }),
    },
  }),
}));

jest.mock('@/lib/ecommerce-assistant/storage', () => ({
  getEcommerceStore: () => fakeStore,
}));

const mockProvider = (
  type: 'image' | 'analysis',
  ok: boolean,
): ApiProvider | null => {
  if (!ok) return null;
  return {
    id: `${type}-provider-id`,
    name: `${type} provider`,
    api_protocol: 'openai-compatible',
    capabilities: type === 'image' ? ['image-gen'] : ['agent-chat', 'text-gen'],
  } as never;
};

let imageProviderOk = true;
let analysisProviderOk = true;

jest.mock('@/lib/provider-resolver', () => ({
  ProviderResolutionError: class extends Error {},
  resolveProviderForCapability: ({ moduleKey }: { moduleKey: string }) => {
    if (moduleKey === 'image') {
      return mockProvider('image', imageProviderOk) ?? (() => {
        throw new Error('no image provider');
      })();
    }
    return mockProvider('analysis', analysisProviderOk) ?? (() => {
      throw new Error('no analysis provider');
    })();
  },
}));

jest.mock('@/lib/provider-config', () => ({
  providerSupportsCapability: () => true,
}));

import { GET } from '../route';

describe('GET /api/apps/builtin/ecommerce/status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    imageProviderOk = true;
    analysisProviderOk = true;
    fakeStore.count.mockReturnValue(0);
    fakeStore.query.mockReturnValue([]);
  });

  it('returns ready=true when both providers resolve and store works', async () => {
    fakeStore.count.mockReturnValueOnce(2); // ready inputs
    fakeStore.query.mockReturnValueOnce([
      { id: 'job-1', status: 'completed', updated_at: '2026-05-09' },
    ]);
    const res = await GET();
    const json = await res.json();
    expect(json.ready).toBe(true);
    expect(json.phase).toBe('ready');
    expect(json.providers.image.ok).toBe(true);
    expect(json.providers.analysis.ok).toBe(true);
    expect(json.inventory.inputCount).toBe(2);
    expect(json.lastJob).not.toBeNull();
  });

  it('reports phase=needs-image-provider when image provider unavailable', async () => {
    imageProviderOk = false;
    const res = await GET();
    const json = await res.json();
    expect(json.ready).toBe(false);
    expect(json.phase).toBe('needs-image-provider');
    expect(json.providers.image.ok).toBe(false);
  });

  it('reports phase=needs-analysis-provider when analysis provider unavailable', async () => {
    analysisProviderOk = false;
    const res = await GET();
    const json = await res.json();
    expect(json.ready).toBe(false);
    expect(json.phase).toBe('needs-analysis-provider');
    expect(json.providers.analysis.ok).toBe(false);
  });

  it('counts running jobs across all non-terminal statuses', async () => {
    fakeStore.query.mockReturnValueOnce([
      { id: 'a', status: 'running', updated_at: '1' },
      { id: 'b', status: 'queued', updated_at: '2' },
      { id: 'c', status: 'cutting', updated_at: '3' },
      { id: 'd', status: 'completed', updated_at: '4' },
      { id: 'e', status: 'failed', updated_at: '5' },
      { id: 'f', status: 'cancelled', updated_at: '6' },
    ]);
    const res = await GET();
    const json = await res.json();
    expect(json.inventory.runningJobs).toBe(3);
  });
});
