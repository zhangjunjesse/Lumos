"use client";

import { useEffect, useCallback } from 'react';
import { useContentPanelStore, type Tab } from '@/stores/content-panel';
import { TabBar } from './TabBar';
import { ContentRenderer } from './ContentRenderer';

interface ContentPanelProps {
  width?: number;
}

export function ContentPanel({ width = 288 }: ContentPanelProps) {
  const { tabs, activeTabId, setActiveTab, removeTab, addTab } = useContentPanelStore();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modKey = isMac ? e.metaKey : e.ctrlKey;

    // Cmd/Ctrl + T: Add new tab (Settings by default)
    if (modKey && e.key === 't') {
      e.preventDefault();
      addTab({
        type: 'settings',
        title: 'Settings',
        closable: true,
      });
      return;
    }

    // Cmd/Ctrl + 1-9: Switch to tab by index
    if (modKey && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const index = parseInt(e.key) - 1;
      if (tabs[index]) {
        setActiveTab(tabs[index].id);
      }
      return;
    }

    // Cmd/Ctrl + W: Close current tab
    if (modKey && e.key === 'w') {
      e.preventDefault();
      if (activeTabId) {
        const tab = tabs.find((t: Tab) => t.id === activeTabId);
        if (tab?.closable) {
          removeTab(activeTabId);
        }
      }
      return;
    }

    // Cmd/Ctrl + Shift + [: Previous tab
    if (modKey && e.shiftKey && e.key === '[') {
      e.preventDefault();
      if (activeTabId && tabs.length > 1) {
        const currentIndex = tabs.findIndex((t: Tab) => t.id === activeTabId);
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
        setActiveTab(tabs[prevIndex].id);
      }
      return;
    }

    // Cmd/Ctrl + Shift + ]: Next tab
    if (modKey && e.shiftKey && e.key === ']') {
      e.preventDefault();
      if (activeTabId && tabs.length > 1) {
        const currentIndex = tabs.findIndex((t: Tab) => t.id === activeTabId);
        const nextIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
        setActiveTab(tabs[nextIndex].id);
      }
      return;
    }
  }, [tabs, activeTabId, setActiveTab, removeTab, addTab]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <aside
      className="flex h-full shrink-0 flex-col overflow-hidden bg-background"
      style={{ width }}
    >
      {tabs.length > 0 ? (
        <>
          <TabBar />
          <ContentRenderer />
        </>
      ) : (
        <EmptyState />
      )}
    </aside>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center p-4 text-center">
      <div className="text-sm text-muted-foreground">
        <p>No content to display</p>
        <p className="mt-2">Click + to add a tab</p>
      </div>
    </div>
  );
}
