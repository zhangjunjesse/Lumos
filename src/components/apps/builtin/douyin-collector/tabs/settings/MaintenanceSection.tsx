'use client';

import * as React from 'react';
import { Loader2, Wand } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { Section } from './Section';
import { emitTagsChanged } from '@/lib/douyin-collector/events';
import { useTopTags } from '../../use-top-tags';

interface RenameResult {
  ok: boolean;
  updated?: number;
  changedIds?: string[];
  message?: string;
  error?: string;
}

/**
 * Library hygiene tools. Currently just tag-rename / tag-merge — drives
 * users out of the AI / Ai / ai duplication trap. Future: rebuild
 * indexes, vacuum stale data, etc.
 */
export function MaintenanceSection(): React.ReactElement {
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(
    null,
  );
  // Auto-dismiss feedback after 8s (same pattern as Round 114).
  React.useEffect(() => {
    if (!feedback) return;
    const id = setTimeout(() => setFeedback(null), 8000);
    return () => clearTimeout(id);
  }, [feedback]);
  // Expose existing tags as click-to-fill chips for the "from" field —
  // user picks the bad/duplicate tag without retyping (and risking typos).
  // Auto-refreshes after a successful rename via DOUYIN_TAGS_CHANGED.
  const { tags: existingTags } = useTopTags(0, 30);

  async function submit() {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/apps/builtin/douyin-collector/library/tags/rename', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, to }),
      });
      const json = (await res.json().catch(() => ({}))) as RenameResult;
      if (json.ok) {
        const updated = json.updated ?? 0;
        const note = json.message ?? `已更新 ${updated} 条视频的标签。`;
        setFeedback({ kind: 'ok', text: note });
        if (updated > 0) {
          setFrom('');
          setTo('');
          // Tells HotTagsPanel / OrganizeTab tag suggestions to refetch
          emitTagsChanged();
        }
      } else {
        setFeedback({ kind: 'error', text: json.error ?? '失败' });
      }
    } catch (err) {
      setFeedback({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="维护：标签合并"
      description="把库里所有 AI / Ai / ai 之类的同义标签合并成一个。匹配大小写不敏感；新标签为空则等于删除。"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <div>
          <Label htmlFor="tag-rename-from">旧标签</Label>
          <Input
            id="tag-rename-from"
            placeholder="例如：AI"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="tag-rename-to">新标签（留空表示删除）</Label>
          <Input
            id="tag-rename-to"
            placeholder="例如：ai"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <Button size="sm" disabled={busy || !from.trim()} onClick={() => void submit()}>
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Wand className="size-3.5" />
            )}
            合并
          </Button>
        </div>
      </div>
      {existingTags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            点击填入旧标签
          </span>
          {existingTags.map((t) => (
            <button
              key={t.tag}
              type="button"
              onClick={() => setFrom(t.tag)}
              className={
                from.toLowerCase() === t.tag.toLowerCase()
                  ? 'rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-medium text-foreground'
                  : 'rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground'
              }
              title={`${t.tag} · ${t.count} 个视频`}
            >
              {t.tag}
              <span className="ml-1 text-[9px] opacity-60">{t.count}</span>
            </button>
          ))}
        </div>
      ) : null}
      {feedback ? (
        <Alert variant={feedback.kind === 'ok' ? 'default' : 'destructive'}>
          <AlertDescription>{feedback.text}</AlertDescription>
        </Alert>
      ) : null}
    </Section>
  );
}
