'use client';

import { Card } from '@/components/ui/card';
import { UnderstandingProgress } from './understanding-progress';
import { Crown } from 'lucide-react';

interface MasterProfileCardProps {
  understanding: number;
}

export function MasterProfileCard({ understanding }: MasterProfileCardProps) {
  return (
    <Card className="relative overflow-hidden border-[3px] border-[#FDE68A] bg-gradient-to-br from-[#FFFBEB] to-white shadow-[0_0_20px_rgba(255,215,0,0.4)] transition-all hover:shadow-[0_0_30px_rgba(255,215,0,0.6)] hover:-translate-y-1.5">
      <div className="absolute inset-0 bg-gradient-to-br from-[#FFD700]/10 to-transparent animate-pulse" style={{ animationDuration: '3s' }} />
      <div className="relative p-6">
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-[#FFD700] to-[#FFA500]">
              <Crown className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-[#D97706]">关于你</h3>
              <p className="text-sm text-muted-foreground">Lumos 眼中的你</p>
            </div>
          </div>
          <UnderstandingProgress value={understanding} size={80} strokeWidth={6} />
        </div>
        <div className="space-y-4 text-sm text-muted-foreground">
          <p>通过对话，我会逐渐了解你的工作方式、沟通偏好和专业领域。</p>
          <p className="text-xs">💡 多和我聊聊，我会更懂你</p>
        </div>
      </div>
    </Card>
  );
}
