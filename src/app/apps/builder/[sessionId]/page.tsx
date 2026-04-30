'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type {
  BuilderArtifact,
  BuilderMessage,
  BuilderSession,
  SessionStatus,
} from '@/lib/app/builder/session';

/**
 * AppBuilder workspace — the detail view of a single in-progress app.
 *
 * Layout:
 *   ┌──── Header: ← 返回 | 应用名 · 状态 · 描述 | (保存并安装 / 删除) ───┐
 *   ├───────────────────────────────────┬───────────────────────────┤
 *   │ Tabs: 预览 / 文件 / 设置           │  AI 对话                    │
 *   │   (preview is M4 B3, files +      │  message list + composer   │
 *   │    settings live)                  │                             │
 *   └───────────────────────────────────┴───────────────────────────┘
 *
 * The right pane is the same chat persistence the previous /apps/create
 * page used; the left pane gains the per-app context (file tree,
 * settings) instead of forcing the user to think in "sessions".
 */

const STATUS_LABEL: Record<SessionStatus, string> = {
  gathering: '收集需求',
  generating: '生成中',
  installed: '已安装',
  iterating: '迭代中',
  failed: '失败',
};

export default function AppBuilderPage(): React.ReactElement {
  const router = useRouter();
  const params = useParams<{ sessionId: string }>();
  const sessionId = params?.sessionId ?? '';

  const [session, setSession] = React.useState<BuilderSession | null>(null);
  const [messages, setMessages] = React.useState<BuilderMessage[]>([]);
  const [artifacts, setArtifacts] = React.useState<BuilderArtifact[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const messagesScrollRef = React.useRef<HTMLDivElement>(null);

  const refresh = React.useCallback(async () => {
    if (!sessionId) return;
    try {
      const [sRes, mRes, aRes] = await Promise.all([
        fetch(`/api/apps/builder/sessions/${sessionId}`),
        fetch(`/api/apps/builder/sessions/${sessionId}/messages`),
        fetch(`/api/apps/builder/sessions/${sessionId}/artifacts`),
      ]);
      if (!sRes.ok) {
        const json = (await sRes.json()) as { error?: string };
        throw new Error(json.error ?? `${sRes.status}`);
      }
      const sJson = (await sRes.json()) as { session: BuilderSession };
      const mJson = (await mRes.json()) as { messages: BuilderMessage[] };
      const aJson = (await aRes.json()) as { artifacts: BuilderArtifact[] };
      setSession(sJson.session);
      setMessages(mJson.messages);
      setArtifacts(aJson.artifacts);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [sessionId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    messagesScrollRef.current?.scrollTo({
      top: messagesScrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages.length]);

  const handleSend = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!sessionId || !input.trim() || busy) return;
    setBusy(true);
    try {
      await fetch(`/api/apps/builder/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: input }),
      });
      // Mock assistant echo until the Claude SDK bridge lands (M4 B2).
      await fetch(`/api/apps/builder/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'assistant',
          content:
            'AI 创建器目前还在接入 Claude SDK（M4 B2 阶段）。你的消息已经存进会话，等接入完成后这里会出现 AI 的回复并开始生成应用文件。',
        }),
      });
      setInput('');
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteDraft = async () => {
    if (!sessionId) return;
    if (!window.confirm('删除这个草稿？相关对话与文件也会一并丢弃。')) return;
    const res = await fetch(`/api/apps/builder/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      router.push('/apps');
    } else {
      const json = (await res.json()) as { error?: string };
      window.alert(`删除失败：${json.error ?? '未知错误'}`);
    }
  };

  const handleInstall = () => {
    window.alert(
      '保存并安装会在 AI 创建器接入 Claude（M4 B2）后启用：届时 AI 会先生成 manifest / pages / workflow，再走标准的安装-授权流程。',
    );
  };

  if (error && !session) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" asChild className="mt-4">
          <Link href="/apps">返回应用列表</Link>
        </Button>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="p-6 text-sm text-muted-foreground">加载中…</div>
    );
  }

  const appName = session.appName ?? '未命名应用';
  const description = session.appDescription ?? '';
  const isInstalled = !!session.appId;
  const statusLabel = STATUS_LABEL[session.status];

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="flex items-center gap-4 border-b px-6 py-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/apps">← 返回</Link>
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <h1 className="truncate text-lg font-semibold">{appName}</h1>
          <span
            className={
              isInstalled
                ? 'rounded bg-green-500/15 px-2 py-0.5 text-xs text-green-700 dark:text-green-400'
                : 'rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400'
            }
          >
            {isInstalled ? '已安装' : `${statusLabel} · 草稿`}
          </span>
          {description ? (
            <span className="truncate text-sm text-muted-foreground">
              · {description}
            </span>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handleDeleteDraft}>
            删除
          </Button>
          <Button size="sm" onClick={handleInstall} disabled={artifacts.length === 0}>
            保存并安装
          </Button>
        </div>
      </header>

      {/* Two-pane workspace */}
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_minmax(360px,40%)]">
        {/* Left: tabs */}
        <section className="flex min-h-0 flex-col border-r">
          <Tabs defaultValue="files" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="m-3 self-start">
              <TabsTrigger value="preview">预览</TabsTrigger>
              <TabsTrigger value="files">文件</TabsTrigger>
              <TabsTrigger value="settings">设置</TabsTrigger>
            </TabsList>

            <TabsContent value="preview" className="min-h-0 flex-1 overflow-y-auto p-4 pt-0">
              <Card>
                <CardContent className="flex flex-col gap-2 p-6 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">实时预览</p>
                  <p>
                    生成中的页面会渲染在这里。预览功能在 M4 B3 阶段接入；当前你可以
                    在「文件」标签查看 AI 已经生成的 JSON。
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="files" className="min-h-0 flex-1 overflow-y-auto p-4 pt-0">
              {artifacts.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col gap-2 p-6 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">还没有文件</p>
                    <p>
                      在右侧描述你想要的应用，AI 会逐步生成 manifest、页面、
                      工作流等文件，结果会出现在这里。
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <ul className="flex flex-col gap-3">
                  {artifacts.map((a) => (
                    <li key={a.id}>
                      <Card>
                        <CardContent className="p-4">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="truncate font-mono text-sm font-medium">
                              {a.filePath}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              v{a.version} · {a.status}
                            </span>
                          </div>
                          <pre className="max-h-64 overflow-auto rounded bg-muted p-3 text-xs">
                            {a.content}
                          </pre>
                        </CardContent>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="settings" className="min-h-0 flex-1 overflow-y-auto p-4 pt-0">
              <Card>
                <CardContent className="flex flex-col gap-3 p-6 text-sm">
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">
                      应用名
                    </div>
                    <div>{appName}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">描述</div>
                    <div>{description || '（无）'}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">
                      会话 ID
                    </div>
                    <div className="font-mono text-xs">{session.id}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">
                      已生成文件
                    </div>
                    <div>{artifacts.length} 个</div>
                  </div>
                  {session.appId ? (
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">
                        已安装为
                      </div>
                      <Link
                        href={`/apps/${session.appId}`}
                        className="text-primary hover:underline"
                      >
                        {session.appId}
                      </Link>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </section>

        {/* Right: AI conversation */}
        <section className="flex min-h-0 flex-col">
          <header className="border-b px-4 py-3">
            <div className="text-sm font-semibold">AI 对话</div>
            <div className="text-xs text-muted-foreground">
              用日常语言描述你想要的应用，AI 会先和你确认需求，然后生成文件
            </div>
          </header>
          <div ref={messagesScrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <div className="flex h-full items-center justify-center px-6 text-center">
                <div className="text-sm text-muted-foreground">
                  发一句话开始吧，例如：
                  <br />
                  「能记客户姓名/电话/状态，每周一推送跟进列表」
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={
                      m.role === 'user'
                        ? 'ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground'
                        : m.role === 'tool'
                          ? 'max-w-[95%] rounded-lg bg-muted px-3 py-2 font-mono text-xs'
                          : 'max-w-[85%] rounded-lg border bg-background px-3 py-2 text-sm'
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
                      <div className="whitespace-pre-wrap">{String(m.content)}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <form onSubmit={handleSend} className="border-t p-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="向 AI 描述你想要的应用…"
              rows={3}
              disabled={busy}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  if (!busy && input.trim()) {
                    void handleSend(
                      new Event('submit') as unknown as React.FormEvent<HTMLFormElement>,
                    );
                  }
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between">
              <div className="text-xs text-muted-foreground">⌘/Ctrl + Enter 发送</div>
              <Button type="submit" size="sm" disabled={busy || !input.trim()}>
                {busy ? '发送中…' : '发送'}
              </Button>
            </div>
          </form>
        </section>
      </div>

      {error ? (
        <div className="border-t bg-destructive/10 px-6 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  );
}
