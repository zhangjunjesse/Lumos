'use client';

import * as React from 'react';
import { AlertCircle, FileText, Loader2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { GoofishChatDetail } from '@/components/goofish/GoofishChatDetail';
import { GoofishChatList } from '@/components/goofish/GoofishChatList';
import { GoofishLoginForm } from '@/components/goofish/GoofishLoginForm';
import { type ChatSessionLite } from '@/components/goofish/chat-list-utils';
import { useGoofishAuth } from '@/components/goofish/use-goofish-auth';

import { APP_ID, nativeActionUrl } from './use-goofish-app-data';

interface SelectedSession {
  session_id: string;
  peer_nick: string;
  peer_user_id: string;
  peer_avatar: string;
  unread: number;
  account_unb: string;
}

/**
 * Inbox = 左买家会话列表 + 右会话详情。
 * 详情底部多一个「生成草稿」按钮（调用 native-action 写入 reply_drafts，
 * 然后用户在 DraftsTab 里确认并发送）。
 *
 * 未登录（status.phase='needs-auth'）时整 Tab 直接渲染 GoofishLoginForm。
 */
export function InboxTab(): React.ReactElement {
  const { status, busy, login } = useGoofishAuth();
  const [selected, setSelected] = React.useState<SelectedSession | null>(null);

  const accounts = status?.accounts ?? [];
  const validAccounts = accounts.filter((a) => a.valid);
  const phase = !status
    ? 'loading'
    : !status.installed
      ? 'needs-install'
      : validAccounts.length === 0
        ? 'needs-auth'
        : 'ready';

  if (phase === 'loading') {
    return (
      <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        加载状态…
      </div>
    );
  }

  if (phase === 'needs-install') {
    return (
      <Alert>
        <AlertCircle />
        <AlertDescription>
          闲鱼底层组件 goofish-cli 尚未安装。请先到「扩展 &gt; 闲鱼」完成一键安装后再回来。
        </AlertDescription>
      </Alert>
    );
  }

  if (phase === 'needs-auth') {
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <AlertCircle />
          <AlertDescription>
            闲鱼助手需要登录至少一个闲鱼账号。扫码或粘贴 Cookie 登录后，会话和草稿会自动同步。
          </AlertDescription>
        </Alert>
        <section className="rounded-xl border border-border/60 bg-card p-5">
          <GoofishLoginForm
            hasOtherAccounts={accounts.length > 0}
            busy={busy}
            onLogin={(input) => void login(input)}
          />
        </section>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <div className="min-w-0">
        <GoofishChatList
          account="all"
          onSelect={(s: ChatSessionLite) => setSelected({
            session_id: s.session_id,
            peer_nick: s.peer_nick,
            peer_user_id: s.peer_user_id,
            peer_avatar: s.peer_avatar,
            unread: s.unread,
            account_unb: s.account_unb,
          })}
        />
      </div>
      <div className="min-w-0">
        {selected ? (
          <ChatDetailWithDraft
            session={selected}
            myUserId={validAccounts.find((a) => a.accountUnb === selected.account_unb)?.unb || ''}
            onBack={() => setSelected(null)}
          />
        ) : (
          <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed bg-muted/10 text-xs text-muted-foreground">
            从左侧选择一个买家会话查看消息
          </div>
        )}
      </div>
    </div>
  );
}

function ChatDetailWithDraft({
  session,
  myUserId,
  onBack,
}: {
  session: SelectedSession;
  myUserId: string;
  onBack: () => void;
}): React.ReactElement {
  const [generating, setGenerating] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{
    kind: 'ok' | 'error';
    text: string;
  } | null>(null);

  const generateDraft = React.useCallback(async () => {
    setGenerating(true);
    setFeedback(null);
    try {
      // The native-action uses buyer_conversations row id, not the goofish
      // session_id. Look it up by conversation_id (= session_id).
      const lookup = await fetch(
        `/api/apps/${encodeURIComponent(APP_ID)}/data?collection=buyer_conversations`,
        { cache: 'no-store' },
      );
      const lookupJson = (await lookup.json().catch(() => ({}))) as {
        rows?: Array<{ id: string; conversation_id?: string }>;
        error?: string;
      };
      if (!lookup.ok || !Array.isArray(lookupJson.rows)) {
        throw new Error(lookupJson.error ?? '查找买家会话失败');
      }
      const conv = lookupJson.rows.find((r) => r.conversation_id === session.session_id);
      if (!conv) {
        throw new Error('当前会话尚未同步到闲鱼助手数据库，请先在「自动化」中运行同步。');
      }
      const res = await fetch(nativeActionUrl('goofish', 'generate-reply-draft'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowId: conv.id }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !json.ok) throw new Error(json.message ?? '生成草稿失败');
      setFeedback({ kind: 'ok', text: json.message ?? '已生成草稿，前往「草稿」Tab 确认' });
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : '生成草稿失败',
      });
    } finally {
      setGenerating(false);
    }
  }, [session.session_id]);

  return (
    <div className="flex flex-col gap-3">
      <GoofishChatDetail
        key={session.session_id}
        session={session}
        myUserId={myUserId}
        onBack={onBack}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-4 py-3">
        <div className="min-w-0 text-xs text-muted-foreground">
          AI 会读取此会话最近的买家消息，生成草稿后写入「草稿」Tab，等待确认才发送。
        </div>
        <Button size="sm" onClick={() => void generateDraft()} disabled={generating}>
          {generating ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
          生成草稿
        </Button>
      </div>
      {feedback ? (
        <Alert variant={feedback.kind === 'error' ? 'destructive' : 'default'}>
          <AlertDescription>{feedback.text}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
