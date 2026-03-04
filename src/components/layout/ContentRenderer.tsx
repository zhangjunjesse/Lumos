"use client";

import { useContentPanelStore, type Tab } from '@/stores/content-panel';
import { FileTree } from '@/components/project/FileTree';
import { FeishuPanel } from '@/components/feishu/FeishuPanel';

export function ContentRenderer() {
  const { tabs, activeTabId } = useContentPanelStore();

  const activeTab = tabs.find((t: Tab) => t.id === activeTabId);

  if (!activeTab) {
    return null;
  }

  return (
    <div className="flex-1 overflow-hidden">
      {renderContent(activeTab)}
    </div>
  );
}

function renderContent(tab: Tab) {
  switch (tab.type) {
    case 'file-tree':
      return <FileTree />;

    case 'feishu-doc':
      return <FeishuPanel />;

    case 'settings':
      return <div className="p-4">Settings (Coming Soon)</div>;

    case 'knowledge':
      return <div className="p-4">Knowledge (Coming Soon)</div>;

    case 'plugins':
      return <div className="p-4">Plugins (Coming Soon)</div>;

    default:
      return <div className="p-4">Unknown tab type: {tab.type}</div>;
  }
}
