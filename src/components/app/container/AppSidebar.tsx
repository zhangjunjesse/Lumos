'use client';

import * as React from 'react';

import type { MenuItem } from '@/lib/app/manifest/types';

export interface AppSidebarProps {
  menu: MenuItem[];
  activeId: string;
  onSelect: (menuId: string) => void;
}

export function AppSidebar({ menu, activeId, onSelect }: AppSidebarProps): React.ReactElement {
  return (
    <nav className="flex h-full w-48 shrink-0 flex-col gap-1 border-r bg-muted/30 p-2">
      {menu
        .filter((m) => !m.hidden)
        .map((item) => {
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={
                active
                  ? 'rounded px-3 py-2 text-left text-sm font-medium bg-background shadow-sm'
                  : 'rounded px-3 py-2 text-left text-sm text-muted-foreground hover:bg-background'
              }
            >
              {item.label}
              {item.badge ? (
                <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                  {item.badge}
                </span>
              ) : null}
            </button>
          );
        })}
    </nav>
  );
}
