'use client';

// 提示词管理（按分类）。顶部=当前生效提示词(可直接编辑保存 / 一键恢复内置默认)，
// 下方=该类预设库(设为生效 / 删除 / 新增)。自动任务(抠印花/分析素材/抠姿势)永远用「生效」那条。

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { etsyForgeApi, type PromptItem } from '../api-client';

export function PromptManager({ category }: { category: string }) {
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [defaultContent, setDefaultContent] = useState('');
  const [draft, setDraft] = useState('');
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveRow = prompts.find((p) => p.is_default) ?? null;
  const dirty = draft.trim() !== (effectiveRow?.content ?? defaultContent).trim();

  const load = useCallback(async () => {
    try {
      const r = await etsyForgeApi.listPrompts(category);
      setPrompts(r.prompts);
      setDefaultContent(r.default_content);
      setDraft(r.prompts.find((p) => p.is_default)?.content ?? r.default_content);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [category]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveEffective = () =>
    void run(async () => {
      const content = draft.trim();
      if (!content) return;
      if (effectiveRow) await etsyForgeApi.updatePrompt({ id: effectiveRow.id, content });
      else await etsyForgeApi.createPrompt({ category, name: '自定义', content, is_default: true });
    });

  const setActive = (id: string) => void run(async () => void (await etsyForgeApi.updatePrompt({ id, is_default: true })));

  const addPreset = () =>
    void run(async () => {
      if (!newName.trim() || !newContent.trim()) return;
      await etsyForgeApi.createPrompt({ category, name: newName.trim(), content: newContent.trim() });
      setNewName('');
      setNewContent('');
    });

  const remove = (id: string) => {
    if (!confirm('删除这条提示词？')) return;
    void run(async () => void (await etsyForgeApi.deletePrompt(id)));
  };

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">当前生效</span>
          <span className="text-[10px] text-muted-foreground">
            {effectiveRow ? `（${effectiveRow.name}）` : '（内置默认，未自定义）'}
          </span>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={6}
          className="w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-xs leading-relaxed"
        />
        <div className="flex gap-2">
          <Button size="sm" disabled={busy || !dirty || !draft.trim()} onClick={saveEffective}>
            保存为生效
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setDraft(defaultContent)}>
            恢复内置默认
          </Button>
        </div>
      </div>

      {prompts.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs font-medium">预设库</span>
          {prompts.map((p) => (
            <div key={p.id} className="rounded-md border p-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-foreground">{p.name}</span>
                {p.is_default && (
                  <span className="rounded bg-emerald-500/15 px-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                    生效中
                  </span>
                )}
                <div className="flex-1" />
                {!p.is_default && (
                  <button
                    type="button"
                    onClick={() => setActive(p.id)}
                    disabled={busy}
                    className="text-[11px] text-primary hover:underline disabled:opacity-40"
                  >
                    设为生效
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  disabled={busy}
                  className="text-[11px] text-destructive hover:underline disabled:opacity-40"
                >
                  删除
                </button>
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{p.content}</p>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2 rounded-md border border-dashed p-3">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="新预设名称，如「花园风场景」"
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
        />
        <textarea
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          rows={3}
          placeholder="预设内容（英文指令通常更好）"
          className="w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-xs"
        />
        <Button size="sm" variant="outline" disabled={busy || !newName.trim() || !newContent.trim()} onClick={addPreset}>
          + 添加预设
        </Button>
      </div>
    </div>
  );
}
