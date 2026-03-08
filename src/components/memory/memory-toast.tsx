'use client';

import { useEffect, useState } from 'react';
import { X, Check, AlertCircle, Edit2, Eye } from 'lucide-react';
import type { MemoryRecord } from '@/lib/db/memories';

interface MemoryToastProps {
  memory: MemoryRecord;
  action: 'created' | 'updated' | 'failed';
  error?: string;
  onClose: () => void;
  onView?: () => void;
  onEdit?: () => void;
}

export function MemoryToast({ memory, action, error, onClose, onView, onEdit }: MemoryToastProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 300);
    }, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const getCategoryColor = (category: string) => {
    const colors = {
      preference: 'bg-blue-500',
      constraint: 'bg-red-500',
      fact: 'bg-green-500',
      workflow: 'bg-purple-500',
      other: 'bg-gray-500',
    };
    return colors[category as keyof typeof colors] || colors.other;
  };

  const getIcon = () => {
    if (action === 'failed') return <AlertCircle className="w-5 h-5 text-red-500" />;
    if (action === 'updated') return <Check className="w-5 h-5 text-blue-500" />;
    return <Check className="w-5 h-5 text-green-500" />;
  };

  const getTitle = () => {
    if (action === 'failed') return '记忆保存失败';
    if (action === 'updated') return '记忆已更新';
    return '记忆已保存';
  };

  return (
    <div
      className={`fixed bottom-6 right-6 w-96 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 transition-all duration-300 ${
        isVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
      }`}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          {getIcon()}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm">{getTitle()}</span>
              <span className={`px-2 py-0.5 rounded text-xs text-white ${getCategoryColor(memory.category)}`}>
                {memory.category}
              </span>
            </div>
            {action === 'failed' ? (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">{memory.content}</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X className="w-4 h-4" />
          </button>
        </div>
        {action !== 'failed' && (
          <div className="flex gap-2 mt-3">
            {onView && (
              <button
                onClick={onView}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
              >
                <Eye className="w-3 h-3" />
                查看
              </button>
            )}
            {onEdit && (
              <button
                onClick={onEdit}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
              >
                <Edit2 className="w-3 h-3" />
                编辑
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
