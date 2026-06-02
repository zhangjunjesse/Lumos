// 按协议跑「单图 + 文字」的视觉对话,统一给识图三处(图片分类/二创拆解/二创质检)用。
// openai-compatible → POST /v1/chat/completions(image_url 走 base64 data URL);anthropic-messages → POST /v1/messages(image source base64)。
// 图统一用 base64 喂(两协议都稳,不依赖服务商能否抓远程 URL)。返回回复文本;HTTP 错/空内容 throw。

import type { FetchedImage } from './image-fetch';
import type { VisionEndpoint } from './vision-provider';

export async function visionChat(ep: VisionEndpoint, image: FetchedImage, prompt: string, maxTokens: number, timeoutMs: number): Promise<string> {
  const signal = AbortSignal.timeout(timeoutMs);

  if (ep.protocol === 'anthropic') {
    const res = await fetch(`${ep.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': ep.apiKey,
        Authorization: `Bearer ${ep.apiKey}`, // 兼容部分中转用 Bearer
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      signal,
      body: JSON.stringify({
        model: ep.model,
        max_tokens: maxTokens,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`识图 HTTP ${res.status}`);
    const j = (await res.json()) as { content?: Array<{ type?: string; text?: string }>; error?: { message?: string } };
    if (j.error) throw new Error(j.error.message || '识图服务异常');
    const text = (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
    if (!text) throw new Error('识图无返回内容');
    return text;
  }

  // openai-compatible
  const dataUrl = `data:${image.mimeType};base64,${image.data}`;
  const res = await fetch(`${ep.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ep.apiKey}`, 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: ep.model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }] }],
    }),
  });
  if (!res.ok) throw new Error(`识图 HTTP ${res.status}`);
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message || '识图服务异常');
  const text = j.choices?.[0]?.message?.content?.trim() ?? '';
  if (!text) throw new Error('识图无返回内容');
  return text;
}
