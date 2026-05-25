'use client';

import { useState, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface MainAgentHistoryItem {
  sessionId: string;
  day: string;
  title: string;
  status: 'active' | 'archived';
  messageCount: number;
  headline: string;
}

interface HistoryResponse {
  items?: MainAgentHistoryItem[];
}

// 主 Agent 历史会话浏览面板。默认收起为一行，展开下拉显示近 30 天列表。
// 数据按需加载——展开时拉一次，避免初始页面渲染就触发 API。
export function MainAgentHistoryPanel() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MainAgentHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const pathname = usePathname() || '';

  const currentSessionId = pathname.startsWith('/main-agent/')
    ? pathname.replace('/main-agent/', '').split('/')[0]
    : '';

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/main-agent/history?limit=30');
      const data = (await response.json()) as HistoryResponse;
      setItems(data.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next && items.length === 0 && !loading) {
        void loadHistory();
      }
    },
    [items.length, loading, loadHistory],
  );

  return (
    <Collapsible
      open={open}
      onOpenChange={handleOpenChange}
      className="border-b border-border bg-background"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground">
        <span className="font-medium">过去 30 天</span>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="max-h-72 overflow-y-auto px-2 pb-2">
          {loading && items.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">读取中…</div>
          )}
          {!loading && !error && items.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">还没有历史会话</div>
          )}
          {error && (
            <div className="px-3 py-2 text-xs text-destructive">加载失败：{error}</div>
          )}
          {items.map((item) => {
            const isCurrent = item.sessionId === currentSessionId;
            return (
              <button
                key={item.sessionId}
                type="button"
                onClick={() => router.push(`/main-agent/${item.sessionId}`)}
                className={`flex w-full items-baseline gap-2 rounded-md px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent ${
                  isCurrent ? 'bg-accent text-accent-foreground' : 'text-foreground'
                }`}
              >
                <span className="w-20 shrink-0 font-mono">{item.day}</span>
                <span className="shrink-0 text-muted-foreground">·</span>
                <span className="line-clamp-1 flex-1 text-muted-foreground">
                  {item.headline || '(无小结)'}
                </span>
                <span className="shrink-0 text-muted-foreground">{item.messageCount} 条</span>
                {item.status === 'archived' && (
                  <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                    已归档
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
