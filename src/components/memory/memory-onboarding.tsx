'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Brain, Sparkles, Archive } from 'lucide-react';

const STORAGE_KEY = 'lumos_memory_onboarding_completed';

export function MemoryOnboarding() {
  const [isOpen, setIsOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    const completed = localStorage.getItem(STORAGE_KEY);
    if (!completed) {
      setIsOpen(true);
    }
  }, []);

  const handleClose = () => {
    if (dontShowAgain) {
      localStorage.setItem(STORAGE_KEY, 'true');
    }
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Brain className="w-6 h-6 text-blue-500" />
            欢迎使用 Lumos 记忆系统
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-purple-500 mt-1 flex-shrink-0" />
            <div>
              <h3 className="font-medium mb-1">智能记忆捕获</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                当你说"<span className="font-mono bg-blue-50 dark:bg-blue-900/30 px-1 rounded">记住</span>"、
                "<span className="font-mono bg-blue-50 dark:bg-blue-900/30 px-1 rounded">以后</span>"、
                "<span className="font-mono bg-blue-50 dark:bg-blue-900/30 px-1 rounded">总是</span>"等关键词时，
                AI 会自动捕获你的偏好和约束。
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Archive className="w-5 h-5 text-green-500 mt-1 flex-shrink-0" />
            <div>
              <h3 className="font-medium mb-1">记忆管理中心</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                访问 <span className="font-mono bg-green-50 dark:bg-green-900/30 px-1 rounded">/mind</span> 页面查看、编辑和管理所有记忆。
                支持按类别、作用域筛选，查看使用历史。
              </p>
            </div>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
            <p className="text-sm text-blue-900 dark:text-blue-100">
              <strong>示例：</strong>"记住我喜欢用 TypeScript 写代码" → AI 会在未来对话中优先推荐 TypeScript 方案
            </p>
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Checkbox
              id="dont-show"
              checked={dontShowAgain}
              onCheckedChange={(checked) => setDontShowAgain(checked === true)}
            />
            <label htmlFor="dont-show" className="text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
              不再显示
            </label>
          </div>
          <Button onClick={handleClose}>开始使用</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
