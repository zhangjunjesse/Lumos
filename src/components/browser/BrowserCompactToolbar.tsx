'use client';

import { ArrowLeft, ArrowRight, Download, History, MoreVertical, Plus, RotateCw, Square, Wand2, X } from 'lucide-react';
import type { BrowserTab } from '@/types/browser';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { URLAutocomplete, type URLSuggestion } from './URLAutocomplete';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

export interface BrowserCompactToolbarProps {
  tabs: BrowserTab[];
  activeTabId: string | null;
  urlValue: string;
  isLoading: boolean;
  suggestions?: URLSuggestion[];
  onUrlChange: (value: string) => void;
  onNavigate: (value: string) => void;
  onCreateTab: () => void;
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onStop: () => void;
  onOpenPanel: (panel: 'context' | 'workflows' | 'downloads') => void;
}

export function BrowserCompactToolbar({
  tabs,
  activeTabId,
  urlValue,
  isLoading,
  suggestions = [],
  onUrlChange,
  onNavigate,
  onCreateTab,
  onSwitchTab,
  onCloseTab,
  onBack,
  onForward,
  onReload,
  onStop,
  onOpenPanel,
}: BrowserCompactToolbarProps) {
  const { t } = useTranslation();
  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  return (
    <div className="flex items-center gap-2 border-b bg-background px-2 py-1.5">
      {/* Tab 列表 */}
      <div className="flex items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onSwitchTab(tab.id)}
            className={cn(
              'group flex h-8 min-w-[120px] max-w-[200px] items-center gap-2 rounded-md px-3 text-sm transition-colors',
              tab.id === activeTabId
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/50'
            )}
          >
            <span className="flex-1 truncate">{tab.title || tab.url || 'New Tab'}</span>
            <X
              className="h-3 w-3 opacity-0 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
            />
          </button>
        ))}
        <Button variant="ghost" size="icon-sm" onClick={onCreateTab} className="h-8 w-8">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* 导航按钮 */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!activeTab?.canGoBack}
          onClick={onBack}
          className="h-8 w-8"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!activeTab?.canGoForward}
          onClick={onForward}
          className="h-8 w-8"
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={isLoading ? onStop : onReload}
          className="h-8 w-8"
        >
          {isLoading ? <Square className="h-3 w-3" /> : <RotateCw className="h-4 w-4" />}
        </Button>
      </div>

      {/* 地址栏 */}
      <div className="flex-1">
        <URLAutocomplete
          value={urlValue}
          suggestions={suggestions}
          onChange={onUrlChange}
          onSubmit={onNavigate}
          placeholder={t('browser.enterUrlOrSearch')}
        />
      </div>

      {/* 功能按钮 */}
      <TooltipProvider>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onOpenPanel('context')}
                className="h-8 w-8"
              >
                <History className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>浏览上下文</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onOpenPanel('workflows')}
                className="h-8 w-8"
              >
                <Wand2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Workflows</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onOpenPanel('downloads')}
                className="h-8 w-8"
              >
                <Download className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>下载管理</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>更多选项</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  );
}
