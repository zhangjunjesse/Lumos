'use client';

import * as React from 'react';
import { Loader2, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { useWeChatContacts, type ContactRow } from './use-wechat-contacts';
import { displayWechatName } from './display-helpers';

export function SettingsExcludedDialog({
  open,
  selectedIds,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  selectedIds: string[];
  onOpenChange: (open: boolean) => void;
  onConfirm: (ids: string[]) => void;
}): React.ReactElement {
  const { contacts, ready, reason, loading, error, load } = useWeChatContacts();
  const [draft, setDraft] = React.useState<Set<string>>(new Set(selectedIds));
  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setDraft(new Set(selectedIds));
      setQuery('');
      void load();
    }
  }, [open, selectedIds, load]);

  // Keep already-excluded ids selectable even if they're not in the freshly
  // loaded contact list (e.g. user excluded a now-archived chat).
  const stickyRows = React.useMemo<ContactRow[]>(() => {
    const known = new Set(contacts.map((c) => c.id));
    return selectedIds
      .filter((id) => !known.has(id))
      .map((id) => ({
        id,
        name: displayWechatName(null, id, {
          groupFallback: '微信群聊',
          contactFallback: '微信联系人',
        }),
        isGroup: id.endsWith('@chatroom'),
      }));
  }, [contacts, selectedIds]);

  const all = React.useMemo(() => [...stickyRows, ...contacts], [stickyRows, contacts]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
  }, [all, query]);

  const persons = filtered.filter((c) => !c.isGroup);
  const groups = filtered.filter((c) => c.isGroup);

  const toggle = (id: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-medium tracking-tight">
            选择不分析的对话
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索联系人 / 群"
              className="pl-9"
              disabled={!ready && !stickyRows.length}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            勾中的人 / 群消息不会进入 AI 分析、不会出现在概况报表里。
          </p>

          <Body
            loading={loading}
            ready={ready}
            reason={reason}
            error={error}
            persons={persons}
            groups={groups}
            draft={draft}
            onToggle={toggle}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => onConfirm(Array.from(draft))}>
            保存（已选 {draft.size}）
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Body({
  loading,
  ready,
  reason,
  error,
  persons,
  groups,
  draft,
  onToggle,
}: {
  loading: boolean;
  ready: boolean;
  reason: string | null;
  error: string | null;
  persons: ContactRow[];
  groups: ContactRow[];
  draft: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex min-h-[160px] items-center justify-center rounded-lg border">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error) {
    return (
      <p className="rounded-lg border bg-rose-500/5 px-3 py-4 text-center text-xs text-rose-700 dark:text-rose-300">
        加载失败：{error}
      </p>
    );
  }
  if (!ready && persons.length === 0 && groups.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
        {reasonHint(reason)}
      </p>
    );
  }
  return (
    <div className="flex max-h-80 flex-col overflow-y-auto rounded-lg border">
      {persons.length > 0 ? (
        <Section title="联系人">
          {persons.map((c) => (
            <Row key={c.id} contact={c} checked={draft.has(c.id)} onToggle={() => onToggle(c.id)} />
          ))}
        </Section>
      ) : null}
      {groups.length > 0 ? (
        <Section title="群">
          {groups.map((c) => (
            <Row key={c.id} contact={c} checked={draft.has(c.id)} onToggle={() => onToggle(c.id)} />
          ))}
        </Section>
      ) : null}
      {persons.length === 0 && groups.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">没有匹配的对话</p>
      ) : null}
    </div>
  );
}

function reasonHint(reason: string | null): string {
  if (reason === 'consent_required') return '请先在页面上方的数据授权区域完成授权。';
  if (reason === 'no_key') return '请先在页面上方的数据授权区域恢复微信消息库密钥。';
  if (reason === 'unsupported_platform') return '当前平台暂不支持读取微信消息。';
  return '尚未就绪，请先完成页面上方的数据授权。';
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <p className="border-b bg-muted/40 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </p>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function Row({
  contact,
  checked,
  onToggle,
}: {
  contact: ContactRow;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50',
        '[&:not(:first-child)]:border-t',
      )}
    >
      <Checkbox checked={checked} onCheckedChange={onToggle} className="pointer-events-none" />
      <span className="min-w-0 flex-1 truncate text-sm">{contact.name}</span>
      <span className="text-[11px] text-muted-foreground">
        {contact.isGroup ? '群' : '联系人'}
      </span>
    </button>
  );
}
