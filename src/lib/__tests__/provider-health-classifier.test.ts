import { classifyProviderProbeResult } from '@/lib/providers/provider-health-classifier';
import type { RawProbeResult } from '@/lib/providers/provider-health-types';

function raw(overrides: Partial<RawProbeResult>): RawProbeResult {
  return {
    ok: false,
    latencyMs: 12,
    ...overrides,
  };
}

describe('provider-health-classifier', () => {
  test('classifies successful probe as available', () => {
    expect(classifyProviderProbeResult(raw({ ok: true, httpStatus: 200 }))).toMatchObject({
      status: 'available',
      ok: true,
      retryable: false,
    });
  });

  test('classifies generic 429 as upstream rate limited or unavailable', () => {
    expect(classifyProviderProbeResult(raw({
      httpStatus: 429,
      bodyText: 'Too Many Requests',
    }))).toMatchObject({
      status: 'upstream_rate_limited_or_unavailable',
      ok: false,
      retryable: true,
    });
  });

  test('classifies exhausted token 429 as quota exhausted', () => {
    expect(classifyProviderProbeResult(raw({
      httpStatus: 429,
      bodyJson: { error: { message: '该令牌额度已用尽 TokenStatusExhausted[sk-***]' } },
    }))).toMatchObject({
      status: 'quota_exhausted',
      retryable: false,
    });
  });

  test('classifies model errors before gateway status', () => {
    expect(classifyProviderProbeResult(raw({
      httpStatus: 503,
      bodyJson: { error: { code: 'model_not_found', message: 'model_not_found' } },
    }))).toMatchObject({
      status: 'model_unavailable',
      retryable: false,
    });
  });

  test('classifies gateway failures as retryable', () => {
    expect(classifyProviderProbeResult(raw({
      httpStatus: 502,
      bodyText: 'bad gateway',
    }))).toMatchObject({
      status: 'gateway_unavailable',
      retryable: true,
    });
  });

  test('classifies abort errors as timeout', () => {
    const error = new Error('This operation was aborted');
    error.name = 'AbortError';
    expect(classifyProviderProbeResult(raw({
      error,
      timedOut: true,
    }))).toMatchObject({
      status: 'timeout',
      retryable: true,
    });
  });
});

