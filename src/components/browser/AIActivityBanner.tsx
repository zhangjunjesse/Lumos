/**
 * AI Activity Banner Component
 * 显示 AI 正在对浏览器执行的操作
 */

'use client';

import React from 'react';
import { Bot, X } from 'lucide-react';

export interface AIActivity {
  id: string;
  action: string;
  timestamp: number;
  status: 'running' | 'success' | 'error';
  details?: string;
}

export interface AIActivityBannerProps {
  activity: AIActivity | null;
  onDismiss?: () => void;
}

export function AIActivityBanner({ activity, onDismiss }: AIActivityBannerProps) {
  if (!activity) {
    return null;
  }

  const getStatusColor = () => {
    switch (activity.status) {
      case 'running':
        return 'bg-blue-100 border-blue-300 text-blue-800';
      case 'success':
        return 'bg-green-100 border-green-300 text-green-800';
      case 'error':
        return 'bg-red-100 border-red-300 text-red-800';
      default:
        return 'bg-gray-100 border-gray-300 text-gray-800';
    }
  };

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-2 border-b
        ${getStatusColor()}
        animate-slide-down
      `}
    >
      {/* AI Icon */}
      <Bot size={20} className="flex-shrink-0" />

      {/* Activity Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{activity.action}</span>
          {activity.status === 'running' && (
            <div className="flex gap-1">
              <div className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          )}
        </div>
        {activity.details && (
          <p className="text-sm opacity-80 truncate">{activity.details}</p>
        )}
      </div>

      {/* Dismiss Button */}
      {onDismiss && activity.status !== 'running' && (
        <button
          onClick={onDismiss}
          className="p-1 rounded hover:bg-black/10 transition-colors"
          title="Dismiss"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
