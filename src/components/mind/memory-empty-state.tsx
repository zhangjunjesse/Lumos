'use client';

import { Brain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

export function MemoryEmptyState() {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <Brain className="w-16 h-16 text-blue-500 mb-4" />
      <h3 className="text-xl font-semibold mb-2">让 Lumos 记住你的偏好</h3>
      <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-md">
        Lumos 会在对话中学习你的习惯和偏好，让每次对话都更懂你。
      </p>

      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-6 max-w-md text-left">
        <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">你也可以主动告诉 Lumos：</p>
        <div className="space-y-2 text-sm">
          <div className="flex items-start gap-2">
            <span>💡</span>
            <span className="text-gray-600 dark:text-gray-400">"记住：我喜欢用 TypeScript"</span>
          </div>
          <div className="flex items-start gap-2">
            <span>📏</span>
            <span className="text-gray-600 dark:text-gray-400">"代码中不要使用 any 类型"</span>
          </div>
          <div className="flex items-start gap-2">
            <span>📚</span>
            <span className="text-gray-600 dark:text-gray-400">"我们的 API 地址是 api.example.com"</span>
          </div>
        </div>
      </div>

      <Button onClick={() => router.push('/main-agent')}>
        开始第一次对话
      </Button>
    </div>
  );
}
