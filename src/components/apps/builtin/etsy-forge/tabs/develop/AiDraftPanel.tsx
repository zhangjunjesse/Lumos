'use client';

// AI 文案草稿(R2 草稿优先)：看本产品自有主图 + 选品情报生成草稿 → 落 copy_draft 展示，
// 用户「采用」才覆盖正式字段。绝不自动写正式字段。
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listingApi } from './listing-api';
import type { SectionProps } from './use-listing-editor';

function Adopt({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={onClick}>
      采用{label}
    </Button>
  );
}

export function AiDraftPanel({ listing, patch }: Pick<SectionProps, 'listing' | 'patch'>) {
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = listing.copy_draft;

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await listingApi.aiDraft(listing.id, hint);
      patch({ copy_draft: r.draft }); // 落本地展示(服务端已存)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-fuchsia-500" />
        <span className="text-sm font-medium">AI 文案草稿</span>
        <span className="text-xs text-muted-foreground">看主图 + 选品情报生成，草稿优先，改完才算数</span>
      </div>
      <div className="mt-2 flex gap-2">
        <Input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="补一句卖点（可选）" className="h-8" />
        <Button size="sm" onClick={() => void generate()} disabled={loading}>
          {loading ? '生成中…' : '生成草稿'}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {draft && (
        <div className="mt-3 space-y-2 text-sm">
          {draft.title && (
            <div className="flex items-start justify-between gap-2 rounded border bg-background p-2">
              <div className="min-w-0"><span className="text-xs text-muted-foreground">标题</span><p className="break-words">{draft.title}</p></div>
              <Adopt label="标题" onClick={() => patch({ title: draft.title })} />
            </div>
          )}
          {draft.description && (
            <div className="flex items-start justify-between gap-2 rounded border bg-background p-2">
              <div className="min-w-0"><span className="text-xs text-muted-foreground">描述</span><p className="line-clamp-4 whitespace-pre-wrap break-words">{draft.description}</p></div>
              <Adopt label="描述" onClick={() => patch({ description: draft.description })} />
            </div>
          )}
          {!!draft.tags?.length && (
            <div className="flex items-start justify-between gap-2 rounded border bg-background p-2">
              <div className="min-w-0"><span className="text-xs text-muted-foreground">标签</span><p className="break-words">{draft.tags.join(', ')}</p></div>
              <Adopt label="标签" onClick={() => patch({ tags: draft.tags })} />
            </div>
          )}
          {!!draft.materials?.length && (
            <div className="flex items-start justify-between gap-2 rounded border bg-background p-2">
              <div className="min-w-0"><span className="text-xs text-muted-foreground">材料</span><p className="break-words">{draft.materials.join(', ')}</p></div>
              <Adopt label="材料" onClick={() => patch({ materials: draft.materials })} />
            </div>
          )}
          <Button
            size="sm"
            variant="secondary"
            className="h-7"
            onClick={() => patch({ title: draft.title ?? listing.title, description: draft.description ?? listing.description, tags: draft.tags ?? listing.tags, materials: draft.materials ?? listing.materials })}
          >
            全部采用
          </Button>
        </div>
      )}
    </div>
  );
}
