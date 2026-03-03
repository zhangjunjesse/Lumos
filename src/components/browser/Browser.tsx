/**
 * Browser UI Component
 * 内置浏览器的主界面组件
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { BrowserTab } from '@/types/browser';
import { BrowserToolbar } from './BrowserToolbar';
import { BrowserTabBar } from './BrowserTabBar';
import { AIActivityBanner, AIActivity } from './AIActivityBanner';

export interface BrowserProps {
  className?: string;
}

export function Browser({ className }: BrowserProps) {
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [aiActivity, setAIActivity] = useState<AIActivity | null>(null);

  // 加载标签页列表
  const loadTabs = useCallback(async () => {
    try {
      const result = await window.electronAPI.browser.getTabs();
      if (result.success && result.tabs) {
        setTabs(result.tabs);
        setActiveTabId(result.activeTabId || null);
      }
    } catch (error) {
      console.error('Failed to load tabs:', error);
    }
  }, []);

  // 创建新标签页
  const handleCreateTab = useCallback(async (url?: string) => {
    try {
      const result = await window.electronAPI.browser.createTab(url);
      if (result.success && result.tabId) {
        await loadTabs();
      }
    } catch (error) {
      console.error('Failed to create tab:', error);
    }
  }, [loadTabs]);

  // 关闭标签页
  const handleCloseTab = useCallback(async (tabId: string) => {
    try {
      const result = await window.electronAPI.browser.closeTab(tabId);
      if (result.success) {
        await loadTabs();
      }
    } catch (error) {
      console.error('Failed to close tab:', error);
    }
  }, [loadTabs]);

  // 切换标签页
  const handleSwitchTab = useCallback(async (tabId: string) => {
    try {
      const result = await window.electronAPI.browser.switchTab(tabId);
      if (result.success) {
        setActiveTabId(tabId);
      }
    } catch (error) {
      console.error('Failed to switch tab:', error);
    }
  }, []);

  // 导航到 URL
  const handleNavigate = useCallback(async (url: string) => {
    if (!activeTabId) {
      await handleCreateTab(url);
      return;
    }

    try {
      setIsLoading(true);
      const result = await window.electronAPI.browser.navigate(activeTabId, url);
      if (result.success) {
        await loadTabs();
      }
    } catch (error) {
      console.error('Failed to navigate:', error);
    } finally {
      setIsLoading(false);
    }
  }, [activeTabId, handleCreateTab, loadTabs]);

  // 监听浏览器事件
  useEffect(() => {
    const unsubscribe = window.electronAPI.browser.onEvent((event, data) => {
      switch (event) {
        case 'tab-created':
        case 'tab-closed':
        case 'tab-switched':
        case 'tab-loaded':
        case 'tab-title-updated':
        case 'tab-favicon-updated':
          loadTabs();
          break;
        case 'tab-loading':
          setIsLoading(data.isLoading);
          break;
        case 'tab-error':
          console.error('Tab error:', data);
          break;
      }
    });

    // 初始加载
    loadTabs();

    return () => {
      unsubscribe();
    };
  }, [loadTabs]);

  const activeTab = tabs.find(tab => tab.id === activeTabId);

  return (
    <div className={`flex flex-col h-full ${className || ''}`}>
      <AIActivityBanner
        activity={aiActivity}
        onDismiss={() => setAIActivity(null)}
      />
      <BrowserToolbar
        activeTab={activeTab}
        isLoading={isLoading}
        onNavigate={handleNavigate}
        onCreateTab={handleCreateTab}
      />
      <BrowserTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSwitchTab={handleSwitchTab}
        onCloseTab={handleCloseTab}
        onCreateTab={handleCreateTab}
      />
      <div className="flex-1 relative bg-white">
        {/* WebContentsView 会在这里渲染 */}
        {tabs.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <p className="text-lg mb-2">No tabs open</p>
              <button
                onClick={() => handleCreateTab()}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Create New Tab
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

