'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatProvider {
  id: string;
  name: string;
  baseUrl: string;
  models: Array<{ value: string; label: string }>;
  isDefault: boolean;
}

const LS_PROVIDER = 'etsy-erank-chat-provider';
const LS_MODEL = 'etsy-erank-chat-model';

function loadLS(key: string): string {
  if (typeof window === 'undefined') return '';
  try { return localStorage.getItem(key) || ''; }
  catch { return ''; }
}

function saveLS(key: string, val: string): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, val); }
  catch { /* ignore */ }
}

interface ChatDockApi {
  /** 把 keyword 加进对话上下文(若已存在则去重) */
  attach: (keyword: string) => void;
  /** 移除 */
  detach: (keyword: string) => void;
  /** 是否在已附加列表 */
  isAttached: (keyword: string) => boolean;
  /** 展开对话框 */
  expand: () => void;
}

const Ctx = React.createContext<ChatDockApi | null>(null);

export function useChatDock(): ChatDockApi {
  const v = React.useContext(Ctx);
  if (!v) throw new Error('useChatDock must be used inside ChatDockProvider');
  return v;
}

export function ChatDockProvider({ runId, children }: { runId: string | null; children: React.ReactNode }): React.ReactElement {
  const [attached, setAttached] = React.useState<string[]>([]);
  const [open, setOpen] = React.useState(false);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Provider/Model 选择 — 默认从 localStorage 取,否则用 server-side default
  const [providers, setProviders] = React.useState<ChatProvider[]>([]);
  const [providerId, setProviderId] = React.useState<string>(() => loadLS(LS_PROVIDER));
  const [model, setModel] = React.useState<string>(() => loadLS(LS_MODEL));

  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/apps/builtin/etsy-erank/chat-providers')
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        if (cancelled || !j) return;
        setProviders(j.providers as ChatProvider[]);
        // 没存过选择 → 用 server default
        if (!providerId && j.defaultProviderId) setProviderId(j.defaultProviderId);
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // providerId 变 → 同步 localStorage,model 也对应更新到该 provider 的可用 model
  React.useEffect(() => {
    if (providerId) saveLS(LS_PROVIDER, providerId);
    const p = providers.find((x) => x.id === providerId);
    if (p && p.models.length > 0) {
      // 如果当前 model 不在新 provider 的 model 列表里,选第一个偏好 model
      if (!model || !p.models.find((m) => m.value === model)) {
        const pref = p.models.find((m) => /sonnet/i.test(m.value))
          ?? p.models.find((m) => /opus/i.test(m.value))
          ?? p.models.find((m) => /haiku/i.test(m.value))
          ?? p.models[0];
        setModel(pref?.value ?? '');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, providers]);

  React.useEffect(() => {
    if (model) saveLS(LS_MODEL, model);
  }, [model]);

  // run 切换时清空对话和附加
  React.useEffect(() => {
    setAttached([]);
    setMessages([]);
    setError(null);
  }, [runId]);

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  const api: ChatDockApi = React.useMemo(() => ({
    attach: (k) => {
      setAttached((cur) => (cur.includes(k) ? cur : [...cur, k]));
      setOpen(true);
    },
    detach: (k) => setAttached((cur) => cur.filter((x) => x !== k)),
    isAttached: (k) => attached.includes(k),
    expand: () => setOpen(true),
  }), [attached]);

  async function send(content: string) {
    const trimmed = content.trim();
    if (!trimmed || sending || !runId) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(next);
    setInput('');
    setSending(true);
    setError(null);
    // 流式接收 — 先追加一条 assistant 占位,后续 delta 拼上
    const assistantIndex = next.length;
    setMessages((cur) => [...cur, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch(`/api/apps/builtin/etsy-erank/runs/${encodeURIComponent(runId)}/keyword-chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          keywords: attached,
          messages: next,
          providerId: providerId || undefined,
          model: model || undefined,
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let acc = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          try {
            const ev = JSON.parse(data) as { delta?: string; done?: boolean; error?: string };
            if (ev.error) throw new Error(ev.error);
            if (ev.delta) {
              acc += ev.delta;
              setMessages((cur) => {
                const copy = cur.slice();
                copy[assistantIndex] = { role: 'assistant', content: acc };
                return copy;
              });
            }
          } catch (e) {
            if (e instanceof Error && e.message) throw e;
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // 失败时移除占位 assistant
      setMessages((cur) => cur.slice(0, assistantIndex));
    } finally {
      setSending(false);
    }
  }

  return (
    <Ctx.Provider value={api}>
      {children}
      {runId && (
        <Dock
          attached={attached}
          onDetach={api.detach}
          open={open}
          setOpen={setOpen}
          messages={messages}
          setMessages={setMessages}
          scrollRef={scrollRef}
          input={input}
          setInput={setInput}
          sending={sending}
          error={error}
          send={send}
          providers={providers}
          providerId={providerId}
          setProviderId={setProviderId}
          model={model}
          setModel={setModel}
        />
      )}
    </Ctx.Provider>
  );
}

const SUGGESTIONS: string[] = [
  '这些 keyword 背后是什么文化/IP/受众?',
  '横向对比,哪个最适合我先做?',
  '有 IP/版权风险吗?要怎么避?',
  '产品形态怎么选?定价怎么定?',
  '头部 listing 在用哪些 SEO 词?',
];

function Dock({
  attached, onDetach, open, setOpen, messages, setMessages, scrollRef, input, setInput, sending, error, send,
  providers, providerId, setProviderId, model, setModel,
}: {
  attached: string[];
  onDetach: (k: string) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  input: string;
  setInput: (v: string) => void;
  sending: boolean;
  error: string | null;
  send: (content: string) => void;
  providers: ChatProvider[];
  providerId: string;
  setProviderId: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
}): React.ReactElement {
  const currentProvider = providers.find((p) => p.id === providerId);
  const hasAttached = attached.length > 0;

  if (!open) {
    return (
      <div className="fixed bottom-4 right-4 z-40">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group flex items-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-xs font-medium text-background shadow-lg ring-1 ring-border transition-all hover:scale-105 hover:opacity-95"
          title={currentProvider ? `${currentProvider.name}${model ? ' · ' + model : ''}` : undefined}
        >
          <span>💬 问 AI</span>
          {hasAttached && (
            <span className="rounded-full bg-emerald-500/40 px-1.5 py-0.5 text-[10px] text-white" title={`已附加 ${attached.length} 个关键词`}>
              {attached.length}
            </span>
          )}
          {messages.length > 0 && (
            <span className="rounded-full bg-sky-500/40 px-1.5 py-0.5 text-[10px] text-white" title={`${messages.length} 条消息`}>
              {messages.length}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 flex max-h-[80vh] w-[440px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl bg-background shadow-2xl ring-1 ring-border animate-in slide-in-from-bottom-4 duration-200">
      {/* 顶部:状态 + 关闭 */}
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-semibold">💬 问 AI</span>
          <span className="truncate text-[11px] text-muted-foreground">{hasAttached ? `已附加 ${attached.length} 个关键词` : '通用提问 · 从 ⑥ 列表点 [+ 问 AI] 添加上下文'}</span>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => setMessages([])}
              className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-background hover:text-foreground"
            >
              清空
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md px-2 py-1 text-muted-foreground hover:bg-background hover:text-foreground"
            title="收起"
            aria-label="收起"
          >
            ▾
          </button>
        </div>
      </div>

      {/* Provider + Model 选择 */}
      {providers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/10 px-3 py-1.5 text-[11px]">
          <span className="text-muted-foreground">模型:</span>
          <select
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            className="rounded border bg-background px-1.5 py-0.5"
            disabled={sending}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.isDefault ? ' · 默认' : ''}
              </option>
            ))}
          </select>
          {currentProvider && currentProvider.models.length > 0 && (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="rounded border bg-background px-1.5 py-0.5"
              disabled={sending}
            >
              {currentProvider.models.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* 附加关键词 chips */}
      {hasAttached && (
        <div className="flex flex-wrap gap-1.5 border-b border-border bg-muted/30 px-3 py-2">
          {attached.map((k) => (
            <span
              key={k}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-300"
            >
              <span className="font-mono">{k}</span>
              <button
                type="button"
                onClick={() => onDetach(k)}
                className="inline-flex size-4 items-center justify-center rounded-full text-[10px] hover:bg-emerald-600/20"
                title="移除"
                aria-label="移除"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 消息列表 */}
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3 text-xs">
        {messages.length === 0 && (
          <div className="space-y-2">
            <div className="text-[11px] text-muted-foreground">
              {hasAttached
                ? `已附加 ${attached.length} 个关键词,AI 看到完整 ④/⑤/⑥ 数据 + 头部 listing。试试:`
                : '从 ⑥ 列表的关键词右边点 [+ 加到对话],或直接通用提问。试试:'}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={sending}
                  onClick={() => send(s)}
                  className="rounded-full bg-muted px-2.5 py-1 text-[11px] hover:bg-muted/70 disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            {m.role === 'user' ? (
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-foreground px-3 py-1.5 text-background whitespace-pre-wrap break-words">
                {m.content}
              </div>
            ) : (
              <div className="max-w-[92%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 leading-relaxed">
                {m.content ? (
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ href, children, ...rest }) => (
                          <a {...rest} href={href} target="_blank" rel="noreferrer" className="text-sky-700 underline decoration-dotted hover:decoration-solid">
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {m.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <span className="text-muted-foreground">…</span>
                )}
              </div>
            )}
          </div>
        ))}
        {error && (
          <div className="rounded bg-red-500/10 px-2 py-1.5 text-red-700 ring-1 ring-red-500/30">
            {error}
          </div>
        )}
      </div>

      {/* 输入 */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) send(input);
        }}
        className="flex gap-2 border-t border-border bg-background p-2.5"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (input.trim()) send(input);
            }
          }}
          placeholder={hasAttached ? `问问这 ${attached.length} 个关键词的事…(Enter 发送 · Shift+Enter 换行)` : '问我点啥…(点 keyword 行的 [+ 问 AI])'}
          rows={2}
          disabled={sending}
          className="flex-1 resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="self-end rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-40"
        >
          {sending ? '…' : '发送'}
        </button>
      </form>
    </div>
  );
}
