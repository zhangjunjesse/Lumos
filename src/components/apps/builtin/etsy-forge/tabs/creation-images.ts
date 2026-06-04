// 从创作会话消息里提取生成图(灵感/二创图)。两种落地都认：
//   ①assistant 文本里的 ```image-gen-result``` 代码块(localPath)
//   ②generate_image 工具结果 block(path/url)
// 「灵感」tab 和「产品」tab(选二创图当印花)共用。

import { parseMessageContent, type Message } from '@/types';
import { unwrapToolResult } from '@/lib/tool-result-parser';

const RESULT_RE = /```image-gen-result\s*\n?([\s\S]*?)\n?\s*```/g;
const serve = (p: string) => `/api/media/serve?path=${encodeURIComponent(p)}`;

export interface CreationImage {
  url: string;
  prompt: string;
  createdAt: string;
}

export function extractCreationImages(messages: Message[]): CreationImage[] {
  const out: CreationImage[] = [];
  for (const m of messages) {
    for (const b of parseMessageContent(m.content)) {
      if (b.type === 'text') {
        RESULT_RE.lastIndex = 0;
        let mt: RegExpExecArray | null;
        while ((mt = RESULT_RE.exec(b.text))) {
          try {
            const json = JSON.parse(mt[1]) as { prompt?: string; created_at?: string; images?: Array<{ localPath?: string }> };
            // 优先用图片真实生成时间;没有才退回消息时间(否则刚生成的图会被错排到老消息那一刻)。
            const createdAt = typeof json.created_at === 'string' ? json.created_at : m.created_at;
            for (const img of json.images ?? []) {
              if (img.localPath) out.push({ url: serve(img.localPath), prompt: json.prompt ?? '', createdAt });
            }
          } catch {
            /* 跳过坏块 */
          }
        }
      } else if (b.type === 'tool_result') {
        const r = unwrapToolResult(b.content);
        const imgs = r && Array.isArray(r.images) ? (r.images as Array<Record<string, unknown>>) : [];
        const prompt = typeof r?.prompt === 'string' ? r.prompt : '';
        const createdAt = typeof r?.created_at === 'string' ? r.created_at : m.created_at; // 优先图片生成时间
        for (const img of imgs) {
          const url = img.url ? String(img.url) : img.path ? serve(String(img.path)) : '';
          if (url) out.push({ url, prompt, createdAt });
        }
      }
    }
  }
  const seen = new Set<string>();
  return out.filter((i) => (seen.has(i.url) ? false : seen.add(i.url))).reverse();
}
