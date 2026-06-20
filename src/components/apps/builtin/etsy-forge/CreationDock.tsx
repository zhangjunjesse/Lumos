'use client';

// 全局「创作助手」—— 右下角浮窗(不占布局、不挤压 tab 操作区)。复用 ChatView + 创作会话(和「仓库」tab 共享)。
// 浮窗里的 ChatView 始终挂载(收起只是 hidden),所以任何地方派发 attach-file-to-chat / insert-text-to-chat
// 都能被它的 bridge 接到;收到事件还会自动展开,让用户看到资源进了输入框。

import { useEffect, useState } from 'react';
import { ChatView } from '@/components/chat/ChatView';
import { Button } from '@/components/ui/button';
import { useCreationSession } from './tabs/use-creation-session';
import { MaterialPicker } from './tabs/MaterialPicker';
import { CreationPromptTemplates } from './tabs/CreationPromptTemplates';

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function CreationDock() {
  const s = useCreationSession();
  const [expanded, setExpanded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  // 任何地方"加入对话"(图/文字)时自动展开。
  useEffect(() => {
    const open = () => setExpanded(true);
    window.addEventListener('attach-image-ref-to-chat', open);
    window.addEventListener('insert-text-to-chat', open);
    return () => {
      window.removeEventListener('attach-image-ref-to-chat', open);
      window.removeEventListener('insert-text-to-chat', open);
    };
  }, []);

  return (
    <>
      {!expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="absolute bottom-4 right-4 z-40 rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg hover:opacity-90"
        >
          创作助手
        </button>
      )}

      {/* 浮窗常驻渲染(ChatView 挂着接"加入对话"事件)，收起时 hidden */}
      <div
        className={`absolute bottom-4 right-4 z-40 flex h-[62vh] max-h-[660px] w-[clamp(420px,38vw,560px)] flex-col overflow-hidden rounded-xl border bg-card shadow-2xl ${expanded ? '' : 'hidden'}`}
      >
        <div className="flex shrink-0 items-center gap-1 border-b px-3 py-2">
          <span className="shrink-0 text-sm font-medium">创作助手</span>
          {s.sessions.length > 0 && (
            <select
              value={s.sessionId}
              onChange={(e) => s.switchSession(e.target.value)}
              title="切换会话"
              className="ml-1 max-w-[120px] truncate rounded border bg-background px-1.5 py-1 text-xs"
            >
              {s.sessions.map((sess, i) => (
                <option key={sess.id} value={sess.id}>
                  会话 {s.sessions.length - i} · {fmtTime(sess.created_at)}
                </option>
              ))}
            </select>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-1.5 text-xs"
            onClick={() => void s.newSession()}
            title="新建会话"
          >
            ＋
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-1.5 text-xs text-muted-foreground hover:text-destructive"
            disabled={!s.sessionId}
            onClick={() => {
              if (window.confirm('删除当前创作会话?该会话的对话和生成记录会一并删除。')) void s.deleteSession(s.sessionId);
            }}
            title="删除当前会话"
          >
            删
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setTemplatesOpen(true)}
          >
            模板
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={!s.sessionId}
            onClick={() => setPickerOpen(true)}
          >
            + 选参考图
          </Button>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label="收起"
            className="px-1.5 text-muted-foreground hover:text-foreground"
          >
            ▾
          </button>
        </div>
        <div className="min-h-0 flex-1">
          {s.error ? (
            <p className="p-4 text-sm text-destructive">{s.error}</p>
          ) : s.sessionId ? (
            <ChatView
              key={s.sessionId}
              sessionId={s.sessionId}
              initialMessages={s.messages}
              initialHasMore={s.hasMore}
              modelName={s.model}
              providerId={s.providerId}
              workingDirectoryOverride={s.workingDirectory}
              fullWidth
              hideEmptyState
            />
          ) : null}
        </div>
      </div>

      {pickerOpen && <MaterialPicker onClose={() => setPickerOpen(false)} />}
      {templatesOpen && <CreationPromptTemplates onClose={() => setTemplatesOpen(false)} />}
    </>
  );
}
