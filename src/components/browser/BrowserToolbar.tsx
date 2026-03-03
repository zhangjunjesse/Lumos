/**
 * Browser Toolbar Component
 * 浏览器工具栏（地址栏、前进后退按钮等）
 */

'use client';

import React, { useState, useEffect } from 'react';
import { BrowserTab } from '@/types/browser';
import { ArrowLeft, ArrowRight, RotateCw, Home, Share } from 'lucide-react';
import { URLAutocomplete } from './URLAutocomplete';

export interface BrowserToolbarProps {
  activeTab?: BrowserTab;
  isLoading: boolean;
  onNavigate: (url: string) => void;
  onCreateTab: (url?: string) => void;
  onShareToAI?: () => void;
}

export function BrowserToolbar({
  activeTab,
  isLoading,
  onNavigate,
  onCreateTab,
  onShareToAI,
}: BrowserToolbarProps) {
  const [urlInput, setUrlInput] = useState('');

  useEffect(() => {
    if (activeTab) {
      setUrlInput(activeTab.url);
    }
  }, [activeTab]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    processURL(urlInput);
  };

  const processURL = (input: string) => {
    let url = input.trim();

    if (!url) return;

    // 简单的 URL 补全
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      if (url.includes('.') && !url.includes(' ')) {
        url = `https://${url}`;
      } else {
        url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
      }
    }

    onNavigate(url);
  };

  const handleGoBack = async () => {
    if (activeTab?.canGoBack) {
      // TODO: 实现后退功能
      console.log('Go back');
    }
  };

  const handleGoForward = async () => {
    if (activeTab?.canGoForward) {
      // TODO: 实现前进功能
      console.log('Go forward');
    }
  };

  const handleReload = async () => {
    if (activeTab) {
      onNavigate(activeTab.url);
    }
  };

  const handleGoHome = () => {
    onCreateTab('https://www.google.com');
  };

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-gray-100 border-b border-gray-300">
      {/* 导航按钮 */}
      <button
        onClick={handleGoBack}
        disabled={!activeTab?.canGoBack}
        className="p-2 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Go back"
      >
        <ArrowLeft size={18} />
      </button>

      <button
        onClick={handleGoForward}
        disabled={!activeTab?.canGoForward}
        className="p-2 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Go forward"
      >
        <ArrowRight size={18} />
      </button>

      <button
        onClick={handleReload}
        disabled={!activeTab || isLoading}
        className="p-2 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Reload"
      >
        <RotateCw size={18} className={isLoading ? 'animate-spin' : ''} />
      </button>

      <button
        onClick={handleGoHome}
        className="p-2 rounded hover:bg-gray-200"
        title="Home"
      >
        <Home size={18} />
      </button>

      {/* 地址栏 */}
      <form onSubmit={handleSubmit} className="flex-1">
        <URLAutocomplete
          value={urlInput}
          onChange={setUrlInput}
          onSelect={processURL}
          placeholder="Enter URL or search..."
        />
      </form>

      {/* 分享到 AI 按钮 */}
      {onShareToAI && (
        <button
          onClick={onShareToAI}
          disabled={!activeTab}
          className="p-2 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Share page to AI"
        >
          <Share size={18} />
        </button>
      )}
    </div>
  );
}
