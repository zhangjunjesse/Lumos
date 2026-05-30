'use client';

// 灵感：自动归集创作会话产出的生成图，按创建时间(message.created_at)分组、每小时一组。
// 生成图有两种落地：①assistant 文本里的 ```image-gen-result``` 代码块(localPath)
//                  ②generate_image 工具结果 block(path/url)。两种都扫，覆盖所有情况。

import { useMemo, useState } from 'react';
import { parseMessageContent, type Message } from '@/types';
import { unwrapToolResult } from '@/lib/tool-result-parser';
import { ImageLightbox } from './ImageLightbox';
import { QuickAddChat } from './QuickAddChat';

const RESULT_RE = /```image-gen-result\s*\n?([\s\S]*?)\n?\s*```/g;
const serve = (p: string) => `/api/media/serve?path=${encodeURIComponent(p)}`;

interface WhImage {
  url: string;
  prompt: string;
  createdAt: string;
}

function extractImages(messages: Message[]): WhImage[] {
  const out: WhImage[] = [];
  for (const m of messages) {
    for (const b of parseMessageContent(m.content)) {
      if (b.type === 'text') {
        RESULT_RE.lastIndex = 0;
        let mt: RegExpExecArray | null;
        while ((mt = RESULT_RE.exec(b.text))) {
          try {
            const json = JSON.parse(mt[1]) as { prompt?: string; images?: Array<{ localPath?: string }> };
            for (const img of json.images ?? []) {
              if (img.localPath) out.push({ url: serve(img.localPath), prompt: json.prompt ?? '', createdAt: m.created_at });
            }
          } catch {
            /* 跳过坏块 */
          }
        }
      } else if (b.type === 'tool_result') {
        const r = unwrapToolResult(b.content);
        const imgs = r && Array.isArray(r.images) ? (r.images as Array<Record<string, unknown>>) : [];
        const prompt = typeof r?.prompt === 'string' ? r.prompt : '';
        for (const img of imgs) {
          const url = img.url ? String(img.url) : img.path ? serve(String(img.path)) : '';
          if (url) out.push({ url, prompt, createdAt: m.created_at });
        }
      }
    }
  }
  // 去重(同图只留一张) + 新产出排前面
  const seen = new Set<string>();
  return out.filter((i) => (seen.has(i.url) ? false : seen.add(i.url))).reverse();
}

function hourLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '未知时间';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`;
}

// 按小时分组，保持原顺序(新在前)；items 带扁平 index 供 lightbox 跨组放大。
function groupByHour(images: WhImage[]): { label: string; items: { im: WhImage; idx: number }[] }[] {
  const groups: { label: string; items: { im: WhImage; idx: number }[] }[] = [];
  const map = new Map<string, number>();
  images.forEach((im, idx) => {
    const label = hourLabel(im.createdAt);
    let gi = map.get(label);
    if (gi === undefined) {
      gi = groups.length;
      map.set(label, gi);
      groups.push({ label, items: [] });
    }
    groups[gi].items.push({ im, idx });
  });
  return groups;
}

export function WarehouseView({ messages }: { messages: Message[] }) {
  const images = useMemo(() => extractImages(messages), [messages]);
  const groups = useMemo(() => groupByHour(images), [images]);
  const [idx, setIdx] = useState(-1);

  if (images.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
        灵感库还是空的。去「创作助手」选参考图 + 说要求生成图，产出会自动归集到这里。
      </p>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-1">
      {groups.map((g) => (
        <section key={g.label} className="mb-5">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">
            {g.label} · {g.items.length} 张
          </h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7">
            {g.items.map(({ im, idx: flatIdx }) => (
              <div key={`${im.url}-${flatIdx}`} className="group relative">
                <button
                  type="button"
                  onClick={() => setIdx(flatIdx)}
                  title={im.prompt || '放大'}
                  className="block w-full overflow-hidden rounded border hover:ring-1 hover:ring-foreground"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={im.url} alt="生成图" className="aspect-square w-full object-cover" />
                </button>
                <QuickAddChat imageUrl={im.url} refLabel="二创图" className="absolute right-1 top-1" />
              </div>
            ))}
          </div>
        </section>
      ))}
      {idx >= 0 && (
        <ImageLightbox
          images={images.map((im) => ({ url: im.url, title: im.prompt }))}
          index={idx}
          onIndexChange={setIdx}
          onClose={() => setIdx(-1)}
        />
      )}
    </div>
  );
}
