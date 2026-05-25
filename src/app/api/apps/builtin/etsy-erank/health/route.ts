import { NextResponse } from 'next/server';

import { probeAdsPower } from '@/lib/etsy-erank/adspower';
import { describeScoreProvider, loadScoreProvider } from '@/lib/etsy-erank/scorer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function pingLLM(baseUrl: string, apiKey: string, model: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: 'reply ok' }] }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const txt = (await res.text()).slice(0, 200);
      return { ok: false, error: `HTTP ${res.status}: ${txt}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET() {
  const adspower = await probeAdsPower();
  const described = describeScoreProvider();
  let llm: { available: boolean; providerName?: string; baseUrl?: string; model?: string; error?: string } = {
    available: false,
    providerName: described.providerName,
    baseUrl: described.baseUrl,
    model: described.model,
    error: described.error,
  };
  if (described.ok) {
    // 真实 ping 一次,验证 endpoint 可用
    try {
      const p = loadScoreProvider();
      const ping = await pingLLM(p.baseUrl, p.apiKey, p.model);
      if (ping.ok) {
        llm = { available: true, providerName: described.providerName, baseUrl: p.baseUrl, model: p.model };
      } else {
        llm = { available: false, providerName: described.providerName, baseUrl: p.baseUrl, model: p.model, error: `endpoint 不可用: ${ping.error}` };
      }
    } catch (err) {
      llm = { available: false, providerName: described.providerName, baseUrl: described.baseUrl, model: described.model, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return NextResponse.json({ adspower, llm });
}
