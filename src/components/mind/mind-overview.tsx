'use client';

import { Crown, Sparkles, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface UserInsight {
  text: string;
}

interface OverviewData {
  userInsights: UserInsight[];
  aiPersonality: string;
  interactionStyle: string;
}

export function MindOverview({ data }: { data: OverviewData }) {
  return (
    <div className="space-y-6 max-w-5xl mx-auto p-6">
      {/* 主人画像 - 占据主要视觉空间 */}
      <div className="mind-simple-card mind-user-card col-span-2">
        <div className="flex items-start gap-6">
          <Crown className="w-12 h-12 text-amber-600 flex-shrink-0" />
          <div className="flex-1">
            <h2 className="text-2xl font-semibold mb-3">关于你</h2>
            <p className="text-muted-foreground mb-4">Lumos 这样理解你：</p>

            <ul className="mind-insight-list">
              {data.userInsights.map((insight, i) => (
                <li key={i}>{insight.text}</li>
              ))}
            </ul>

            <Button variant="ghost" className="mt-4 mind-link-button">
              了解更多 →
            </Button>
          </div>
        </div>
      </div>

      {/* AI 人格 + 相处方式 - 并排展示 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="mind-simple-card mind-ai-card">
          <Sparkles className="w-8 h-8 text-indigo-600 mb-3" />
          <h3 className="font-semibold mb-2">Lumos 的性格</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {data.aiPersonality}
          </p>
          <Button variant="ghost" size="sm" className="mind-link-button">
            查看详情 →
          </Button>
        </div>

        <div className="mind-simple-card mind-rules-card">
          <BookOpen className="w-8 h-8 text-slate-600 mb-3" />
          <h3 className="font-semibold mb-2">相处方式</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {data.interactionStyle}
          </p>
          <Button variant="ghost" size="sm" className="mind-link-button">
            查看详情 →
          </Button>
        </div>
      </div>
    </div>
  );
}
