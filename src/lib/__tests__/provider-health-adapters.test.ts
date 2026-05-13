import { AnthropicMessagesProbeAdapter } from '@/lib/providers/provider-health-adapters';
import type { ApiProvider } from '@/types';

const originalFetch = global.fetch;

function makeProvider(overrides: Partial<ApiProvider> = {}): ApiProvider {
  return {
    id: 'provider-1',
    name: 'Claude Gateway',
    provider_type: 'anthropic',
    api_protocol: 'anthropic-messages',
    capabilities: JSON.stringify(['agent-chat', 'text-gen']),
    provider_origin: 'system',
    auth_mode: 'api_key',
    base_url: 'https://gateway.example',
    api_key: 'sk-test',
    is_active: 1,
    sort_order: 0,
    extra_env: JSON.stringify({ LUMOS_UPSTREAM_CHANNEL_ID: '5' }),
    model_catalog: '[]',
    model_catalog_source: 'default',
    model_catalog_updated_at: null,
    notes: '',
    is_builtin: 0,
    user_modified: 0,
    default_model: '',
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
    ...overrides,
  };
}

describe('provider-health-adapters', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('anthropic probe sends new-api channel routing headers', async () => {
    const fetchMock = jest.fn(async () => new Response(
      JSON.stringify({ id: 'msg_1', content: [{ type: 'text', text: 'ok' }] }),
      {
        status: 200,
        headers: { 'x-request-id': 'req_1' },
      },
    ));
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new AnthropicMessagesProbeAdapter();
    const result = await adapter.probe({
      provider: makeProvider(),
      model: 'claude-haiku-test',
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      ok: true,
      httpStatus: 200,
      requestId: 'req_1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://gateway.example/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'x-api-key': 'sk-test-5',
      'Specific-Channel-Id': '5',
      'anthropic-version': '2023-06-01',
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'claude-haiku-test',
      max_tokens: 16,
    });
  });
});

