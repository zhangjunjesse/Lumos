"use client";

import { useCallback } from 'react';
import { useContentPanelStore, type Tab } from '@/stores/content-panel';
import { FileTree } from '@/components/project/FileTree';
import { FeishuPanel } from '@/components/feishu/FeishuPanel';
import { DocPreview } from './DocPreview';
import { usePanel } from '@/hooks/usePanel';

export function ContentRenderer() {
  const { tabs, activeTabId } = useContentPanelStore();
  const { workingDirectory, setPreviewFile } = usePanel();

  const handleFileAdd = useCallback((path: string) => {
    window.dispatchEvent(new CustomEvent('attach-file-to-chat', { detail: { path } }));
  }, []);

  const activeTab = tabs.find((t: Tab) => t.id === activeTabId);

  if (!activeTab) {
    return null;
  }

  return (
    <div className="flex-1 overflow-hidden">
      {renderContent(activeTab, workingDirectory, setPreviewFile, handleFileAdd)}
    </div>
  );
}

function renderContent(
  tab: Tab,
  workingDirectory: string,
  setPreviewFile: (path: string | null) => void,
  handleFileAdd: (path: string) => void
) {
  switch (tab.type) {
    case 'file-tree':
      return (
        <FileTree
          key={workingDirectory}
          workingDirectory={workingDirectory}
          onFileSelect={setPreviewFile}
          onFileAdd={handleFileAdd}
        />
      );

    case 'feishu-doc':
      return <FeishuPanel />;

    case 'file-preview':
      if (!tab.filePath) {
        return <div className="p-4">No file path specified</div>;
      }
      return (
        <DocPreview
          key={tab.filePath}
          filePath={tab.filePath}
          viewMode={(tab.data as { viewMode?: 'source' | 'rendered' })?.viewMode || 'source'}
          onViewModeChange={(mode) => {
            const currentData = (tab.data as Record<string, unknown>) || {};
            useContentPanelStore.getState().updateTab(tab.id, {
              data: { ...currentData, viewMode: mode },
            });
          }}
          onClose={() => useContentPanelStore.getState().removeTab(tab.id)}
          onAdd={() => handleFileAdd(tab.filePath!)}
          width={0} // Not used in tab context
        />
      );

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
