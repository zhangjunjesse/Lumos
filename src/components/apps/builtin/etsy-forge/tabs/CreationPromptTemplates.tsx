'use client';

// 创作助手「提示词模板」管理弹层:保存/列出/应用/编辑/删除自定义提示词。
// 应用 = 派发 lumos:chat-draft(append),把模板内容填进创作助手输入框,可再编辑后发送。
// 复用现有 chat-draft 事件机制(同 ecommerce ask-ai),不改 ChatView。

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

const CHAT_DRAFT_EVENT = 'lumos:chat-draft';
const API = '/api/apps/builtin/etsy-forge/creation/prompts';

interface Template {
  id: string;
  name: string;
  content: string;
  created_at: string;
}

export function CreationPromptTemplates({ onClose }: { onClose: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(API);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '加载失败');
      setTemplates(data.templates || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!name.trim() || !content.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存失败');
      setName('');
      setContent('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const apply = (t: Template) => {
    window.dispatchEvent(new CustomEvent(CHAT_DRAFT_EVENT, { detail: { text: t.content, mode: 'append' } }));
    onClose();
  };

  const startEdit = (t: Template) => {
    setEditingId(t.id);
    setEditName(t.name);
    setEditContent(t.content);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditContent('');
  };
  const saveEdit = async (id: string) => {
    if (!editName.trim() || !editContent.trim()) return;
    setError('');
    try {
      const res = await fetch(API, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: editName, content: editContent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '更新失败');
      cancelEdit();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失败');
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm('删除这个模板?')) return;
    setError('');
    try {
      const res = await fetch(`${API}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '删除失败');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-[min(560px,92vw)] flex-col overflow-hidden rounded-xl border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center border-b px-4 py-3">
          <span className="text-sm font-medium">提示词模板</span>
          <div className="flex-1" />
          <button type="button" onClick={onClose} aria-label="关闭" className="px-1.5 text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        {/* 新建模板 */}
        <div className="shrink-0 space-y-2 border-b p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="模板名称"
            maxLength={80}
            className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="提示词内容…"
            rows={3}
            maxLength={8000}
            className="w-full resize-none rounded-md border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
          />
          <div className="flex justify-end">
            <Button size="sm" className="h-8 text-xs" disabled={!name.trim() || !content.trim() || saving} onClick={() => void save()}>
              {saving ? '保存中…' : '保存为模板'}
            </Button>
          </div>
        </div>

        {/* 列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
          {loading ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有模板。在上方保存常用提示词,之后一键填入输入框。</p>
          ) : (
            <ul className="space-y-2">
              {templates.map((t) => (
                <li key={t.id} className="rounded-lg border p-2.5">
                  {editingId === t.id ? (
                    <div className="space-y-2">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        maxLength={80}
                        className="w-full rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
                      />
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={3}
                        maxLength={8000}
                        className="w-full resize-none rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
                      />
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={cancelEdit}>
                          取消
                        </Button>
                        <Button size="sm" className="h-7 text-xs" disabled={!editName.trim() || !editContent.trim()} onClick={() => void saveEdit(t.id)}>
                          保存
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{t.name}</span>
                        <div className="flex-1" />
                        <Button size="sm" className="h-7 text-xs" onClick={() => apply(t)}>
                          应用
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => startEdit(t)}>
                          编辑
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" onClick={() => void remove(t.id)}>
                          删除
                        </Button>
                      </div>
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">{t.content}</p>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
