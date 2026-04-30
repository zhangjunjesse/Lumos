'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import type { BuilderSession, BuilderMessage, BuilderArtifact } from '@/lib/app/builder/session';

/**
 * AI 创建器入口页（双面板 v0）
 *
 * v1 status: persistence + dual-pane shell are wired. The right pane
 * surfaces every draft artifact streamed in by future tool calls.
 * The Claude SDK bridge replaces the mock-assistant POST in the next
 * commit (B2) — until then user-typed messages get an immediate echo
 * so the loop is testable end to end.
 */

export default function CreateAppPage(): React.ReactElement {
  const [sessions, setSessions] = React.useState<BuilderSession[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<BuilderMessage[]>([]);
  const [artifacts, setArtifacts] = React.useState<BuilderArtifact[]>([]);
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refreshSessions = React.useCallback(async () => {
    const res = await fetch('/api/apps/builder/sessions');
    const json = (await res.json()) as { sessions: BuilderSession[] };
    setSessions(json.sessions);
  }, []);

  const refreshActive = React.useCallback(async (id: string) => {
    const [m, a] = await Promise.all([
      fetch(`/api/apps/builder/sessions/${id}/messages`).then((r) => r.json()) as Promise<{ messages: BuilderMessage[] }>,
      fetch(`/api/apps/builder/sessions/${id}/artifacts`).then((r) => r.json()) as Promise<{ artifacts: BuilderArtifact[] }>,
    ]);
    setMessages(m.messages);
    setArtifacts(a.artifacts);
  }, []);

  React.useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  React.useEffect(() => {
    if (activeId) void refreshActive(activeId);
    else {
      setMessages([]);
      setArtifacts([]);
    }
  }, [activeId, refreshActive]);

  const newSession = async () => {
    const res = await fetch('/api/apps/builder/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const json = (await res.json()) as { session: BuilderSession };
    await refreshSessions();
    setActiveId(json.session.id);
  };

  const sendMessage = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeId || !input.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      // 1. Append user message.
      await fetch(`/api/apps/builder/sessions/${activeId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: input }),
      });
      // 2. Mock assistant echo. Replaced by the Claude SDK bridge in B2.
      await fetch(`/api/apps/builder/sessions/${activeId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'assistant',
          content:
            'AppBuilder agent integration is staged for the next commit (M4 B2). ' +
            'Persistence is live — your message has been recorded and is visible in the session timeline.',
        }),
      });
      setInput('');
      await refreshActive(activeId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deleteSession = async (id: string) => {
    if (!window.confirm('删除会话？')) return;
    await fetch(`/api/apps/builder/sessions/${id}`, { method: 'DELETE' });
    if (activeId === id) setActiveId(null);
    await refreshSessions();
  };

  return (
    <div className="grid h-screen grid-cols-[16rem_1fr_24rem]">
      <aside className="overflow-y-auto border-r p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">会话</h2>
          <Button size="sm" onClick={newSession}>
            新会话
          </Button>
        </div>
        <ul className="flex flex-col gap-1">
          {sessions.map((s) => (
            <li key={s.id} className="group relative">
              <button
                type="button"
                onClick={() => setActiveId(s.id)}
                className={
                  activeId === s.id
                    ? 'block w-full rounded bg-accent px-3 py-2 text-left text-sm'
                    : 'block w-full rounded px-3 py-2 text-left text-sm hover:bg-muted'
                }
              >
                <div className="truncate font-medium">{s.id.replace(/^bs_/, '')}</div>
                <div className="text-xs text-muted-foreground">
                  {labelStatus(s.status)} · {new Date(s.updatedAt).toLocaleString()}
                </div>
              </button>
              <button
                type="button"
                onClick={() => deleteSession(s.id)}
                className="absolute right-1 top-1 hidden rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:block"
                aria-label="删除"
              >
                ✕
              </button>
            </li>
          ))}
          {sessions.length === 0 ? (
            <li className="rounded border border-dashed p-3 text-xs text-muted-foreground">
              还没有会话，点上面的&ldquo;新会话&rdquo;按钮开始
            </li>
          ) : null}
        </ul>
      </aside>

      <main className="flex flex-col overflow-hidden">
        <header className="border-b p-4">
          <h1 className="text-lg font-semibold">AI 创建器</h1>
          {!activeId ? (
            <p className="text-sm text-muted-foreground">从左侧选择或创建一个会话</p>
          ) : null}
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          {messages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === 'user'
                  ? 'mb-3 ml-auto max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground'
                  : m.role === 'tool'
                    ? 'mb-3 max-w-[90%] rounded-lg bg-muted px-3 py-2 text-xs font-mono'
                    : 'mb-3 max-w-[80%] rounded-lg border bg-background px-3 py-2 text-sm'
              }
            >
              {m.role === 'tool' ? (
                <>
                  <div className="text-muted-foreground">{m.toolName}</div>
                  <pre className="whitespace-pre-wrap break-words">
                    {JSON.stringify(m.content, null, 2)}
                  </pre>
                </>
              ) : (
                <span className="whitespace-pre-wrap">{String(m.content)}</span>
              )}
            </div>
          ))}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <form onSubmit={sendMessage} className="border-t p-4">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              activeId
                ? '描述你想要的应用，比如：做一个客户管理工具，能记客户姓名/电话，每周一推送跟进列表'
                : '请先新建或选择会话'
            }
            disabled={!activeId || busy}
            rows={3}
          />
          <div className="mt-2 flex justify-end">
            <Button type="submit" disabled={!activeId || !input.trim() || busy}>
              {busy ? '发送中…' : '发送'}
            </Button>
          </div>
        </form>
      </main>

      <aside className="overflow-y-auto border-l p-4">
        <h2 className="mb-3 text-sm font-semibold">已生成文件</h2>
        {artifacts.length === 0 ? (
          <p className="rounded border border-dashed p-3 text-xs text-muted-foreground">
            生成会出现在这里
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {artifacts.map((a) => (
              <Card key={a.id}>
                <CardHeader className="p-3">
                  <CardTitle className="flex items-center justify-between text-sm">
                    <span className="truncate">{a.filePath}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      v{a.version} · {a.status}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0">
                  <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs">
                    {a.content}
                  </pre>
                </CardContent>
              </Card>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

function labelStatus(s: string): string {
  switch (s) {
    case 'gathering':
      return '收集需求';
    case 'generating':
      return '生成中';
    case 'installed':
      return '已安装';
    case 'iterating':
      return '迭代中';
    case 'failed':
      return '失败';
    default:
      return s;
  }
}
