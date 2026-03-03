/**
 * Browser Tab Bar Component
 * 浏览器标签栏
 */

'use client';

import React from 'react';
import { BrowserTab } from '@/types/browser';
import { X, Plus } from 'lucide-react';

export interface BrowserTabBarProps {
  tabs: BrowserTab[];
  activeTabId: string | null;
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCreateTab: () => void;
}

export function BrowserTabBar({
  tabs,
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onCreateTab,
}: BrowserTabBarProps) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-gray-200 border-b border-gray-300 overflow-x-auto">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`
            flex items-center gap-2 px-3 py-2 rounded-t-lg cursor-pointer
            min-w-[120px] max-w-[200px] group
            ${
              tab.id === activeTabId
                ? 'bg-white border-t border-l border-r border-gray-300'
                : 'bg-gray-100 hover:bg-gray-50'
            }
          `}
          onClick={() => onSwitchTab(tab.id)}
        >
          {/* Favicon */}
          {tab.favicon ? (
            <img src={tab.favicon} alt="" className="w-4 h-4 flex-shrink-0" />
          ) : (
            <div className="w-4 h-4 flex-shrink-0 bg-gray-300 rounded" />
          )}

          {/* Title */}
          <span className="flex-1 truncate text-sm">
            {tab.title || 'New Tab'}
          </span>

          {/* Close button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCloseTab(tab.id);
            }}
            className="p-1 rounded hover:bg-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Close tab"
          >
            <X size={14} />
          </button>
        </div>
      ))}

      {/* New tab button */}
      <button
        onClick={onCreateTab}
        className="p-2 rounded hover:bg-gray-300"
        title="New tab"
      >
        <Plus size={18} />
      </button>
    </div>
  );
}
