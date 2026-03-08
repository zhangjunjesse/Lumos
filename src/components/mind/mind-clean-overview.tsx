'use client';

import { User, Sparkles, Handshake, Code, Palette, Zap, Target, MessageCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export function MindCleanOverview() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto p-6">
      {/* 主人画像 */}
      <div className="mind-clean-card mind-user-profile-card">
        <div className="mind-card-header">
          <User className="w-5 h-5 text-amber-600" />
          <h2 className="mind-card-title">Lumos 眼中的你</h2>
        </div>

        <div className="mind-card-quote">
          一位追求简洁优雅的开发者
        </div>

        <div className="mb-5">
          <h3 className="mind-section-title">擅长领域</h3>
          <div className="mind-tags">
            <span className="mind-tag">
              <Code />
              前端开发
            </span>
            <span className="mind-tag">
              <Code />
              TypeScript
            </span>
            <span className="mind-tag">
              <Palette />
              UI 设计
            </span>
          </div>
        </div>

        <div>
          <h3 className="mind-section-title">工作风格</h3>
          <div className="mind-tags">
            <span className="mind-tag">
              <Zap />
              高效
            </span>
            <span className="mind-tag">
              <Target />
              专注
            </span>
            <span className="mind-tag">
              <Sparkles />
              追求完美
            </span>
          </div>
        </div>
      </div>

      {/* AI 人格 */}
      <div className="mind-clean-card">
        <div className="mind-card-header">
          <Sparkles className="w-5 h-5 text-indigo-600" />
          <h2 className="mind-card-title">Lumos 的性格</h2>
        </div>

        <div className="mind-card-quote">
          温暖专业的 AI 助手
        </div>

        <div>
          <h3 className="mind-section-title">性格特点</h3>
          <div className="mind-tags">
            <span className="mind-tag">
              <MessageCircle />
              简洁表达
            </span>
            <span className="mind-tag">
              <Target />
              直击重点
            </span>
            <span className="mind-tag">
              <Handshake />
              友好耐心
            </span>
          </div>
        </div>
      </div>

      {/* 相处方式 */}
      <div className="mind-clean-card">
        <div className="mind-card-header">
          <Handshake className="w-5 h-5 text-slate-600" />
          <h2 className="mind-card-title">相处方式</h2>
        </div>

        <ul className="mind-list">
          <li>回答简洁，不啰嗦</li>
          <li>遇到问题先问清楚</li>
          <li>代码风格遵循项目规范</li>
        </ul>
      </div>
    </div>
  );
}
