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

export function SettingsTopicWhitelistDialog({
  open,
  kind,
  selectedIds,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  kind: 'personal' | 'group';
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

  const filteredByKind = React.useMemo(() => {
    const all = [...stickyRows, ...contacts];
    return all.filter((c) => (kind === 'group' ? c.isGroup : !c.isGroup));
  }, [stickyRows, contacts, kind]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return filteredByKind;
    return filteredByKind.filter(
      (c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
    );
  }, [filteredByKind, query]);

  const toggle = (id: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const title = kind === 'personal' ? '私聊白名单' : '群聊白名单';
  const subtitle =
    kind === 'personal'
      ? '勾中的私聊会进入「近期话题」AI 分析。其它私聊不会被读取。'
      : '勾中的群聊会进入「近期话题」AI 分析。其它群聊不会被读取。';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-medium tracking-tight">{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={kind === 'personal' ? '搜索联系人' : '搜索群'}
              className="pl-9"
              disabled={!ready && !stickyRows.length}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">{subtitle}</p>

          <Body
            loading={loading}
            ready={ready}
            reason={reason}
            error={error}
            rows={filtered}
            draft={draft}
            onToggle={toggle}
            kind={kind}
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
  rows,
  draft,
  onToggle,
  kind,
}: {
  loading: boolean;
  ready: boolean;
  reason: string | null;
  error: string | null;
  rows: ContactRow[];
  draft: Set<string>;
  onToggle: (id: string) => void;
  kind: 'personal' | 'group';
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
  if (!ready && rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
        {reasonHint(reason)}
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
        {kind === 'personal' ? '没有匹配的联系人' : '没有匹配的群'}
      </p>
    );
  }
  return (
    <div className="flex max-h-80 flex-col overflow-y-auto rounded-lg border">
      {rows.map((c, i) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onToggle(c.id)}
          className={cn(
            'flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50',
            i > 0 && 'border-t',
          )}
        >
          <Checkbox checked={draft.has(c.id)} onCheckedChange={() => onToggle(c.id)} className="pointer-events-none" />
          <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
        </button>
      ))}
    </div>
  );
}

function reasonHint(reason: string | null): string {
  if (reason === 'consent_required') return '请先在页面上方的数据授权区域完成授权。';
  if (reason === 'no_key') return '请先在页面上方的数据授权区域恢复微信消息库密钥。';
  if (reason === 'unsupported_platform') return '当前平台暂不支持读取微信消息。';
  return '尚未就绪，请先完成页面上方的数据授权。';
}
