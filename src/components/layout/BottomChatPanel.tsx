'use client';

import { useCallback, useState, type ReactNode } from 'react';

export interface BottomChatRenderProps {
  collapsed: boolean;
  expand: () => void;
}

interface BottomChatPanelProps {
  title?: string;
  actions?: ReactNode;
  expandedHeight?: string;
  children: (props: BottomChatRenderProps) => ReactNode;
}

export function BottomChatPanel({
  title,
  actions,
  expandedHeight = 'h-[min(48vh,40rem)]',
  children,
}: BottomChatPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const expand = useCallback(() => setCollapsed(false), []);

  return (
    <div className="border-t border-border/50 bg-background/95 backdrop-blur">
      <div className="mx-auto max-w-4xl px-4 py-3">
        <div className={`transition-all duration-200 ${
          collapsed ? '' : 'overflow-hidden rounded-2xl border border-border/70 bg-background shadow-sm'
        }`}>
          {!collapsed && (
            <div className={`flex items-center px-3 pt-3 ${title || actions ? 'justify-between' : 'justify-end'}`}>
              {(title || actions) && (
                <div className="flex items-center gap-2">
                  {title && <span className="text-xs font-medium text-muted-foreground">{title}</span>}
                  {actions}
                </div>
              )}
              <button
                onClick={() => setCollapsed(true)}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                收起
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 15l-7-7-7 7" />
                </svg>
              </button>
            </div>
          )}
          <div className={`transition-all duration-200 ${collapsed ? '' : expandedHeight}`}>
            <div className={`h-full ${collapsed ? '' : 'pb-3'}`}>
              {children({ collapsed, expand })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
