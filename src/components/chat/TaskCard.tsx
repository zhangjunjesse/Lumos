'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { TeamRunStage, TeamRunStatus } from '@/types';
import { parseTeamPlanTaskRecord } from '@/types';

interface TaskCardProps {
  content: string;
  sessionId: string;
  onOpenActivity?: (taskId: string) => void;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  pending: { label: '等待审批', color: 'bg-yellow-500', icon: '⏳' },
  approved: { label: '已批准', color: 'bg-blue-500', icon: '✓' },
  rejected: { label: '已拒绝', color: 'bg-red-500', icon: '✕' },
};

const STAGE_STATUS: Record<string, { label: string; icon: string }> = {
  done: { label: '完成', icon: '✅' },
  running: { label: '执行中', icon: '🔄' },
  ready: { label: '就绪', icon: '🟡' },
  waiting: { label: '等待中', icon: '⏳' },
  pending: { label: '等待中', icon: '⏳' },
  failed: { label: '失败', icon: '❌' },
  blocked: { label: '阻塞', icon: '🚫' },
  cancelled: { label: '已取消', icon: '⊘' },
};

function getRunStatusInfo(status: TeamRunStatus) {
  if (status === 'done') return { label: '已完成', variant: 'default' as const };
  if (status === 'running') return { label: '执行中', variant: 'secondary' as const };
  if (status === 'failed') return { label: '失败', variant: 'destructive' as const };
  if (status === 'cancelled') return { label: '已取消', variant: 'outline' as const };
  return { label: status, variant: 'outline' as const };
}

function StageItem({ stage }: { stage: TeamRunStage }) {
  const cfg = STAGE_STATUS[stage.status] || STAGE_STATUS.pending;
  return (
    <div className="flex items-center gap-2 text-sm py-0.5">
      <span className="w-4 text-center text-xs">{cfg.icon}</span>
      <span className="flex-1 truncate">{stage.title}</span>
      <span className="text-xs text-muted-foreground">{cfg.label}</span>
    </div>
  );
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">{pct}%</span>
    </div>
  );
}

export function TaskCard({ content, onOpenActivity }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false);

  const record = useMemo(() => parseTeamPlanTaskRecord(content), [content]);
  if (!record) return null;

  const { plan, run, approvalStatus } = record;
  const completedCount = run.phases.filter((p) => p.status === 'done').length;
  const totalCount = run.phases.length;
  const runInfo = getRunStatusInfo(run.status);
  const approvalCfg = STATUS_CONFIG[approvalStatus] || STATUS_CONFIG.pending;

  const visibleStages = expanded ? run.phases : run.phases.slice(0, 4);

  return (
    <Card className="my-2 border-border/60 shadow-sm">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium truncate">{plan.summary}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {run.status !== 'pending' && (
              <Badge variant={runInfo.variant} className="text-xs">{runInfo.label}</Badge>
            )}
            {approvalStatus === 'pending' && (
              <Badge variant="outline" className="text-xs border-yellow-500/50 text-yellow-600 dark:text-yellow-400">
                {approvalCfg.label}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-3 pt-0">
        {/* Stage list */}
        <div className="space-y-0.5">
          {visibleStages.map((stage) => (
            <StageItem key={stage.id} stage={stage} />
          ))}
          {!expanded && run.phases.length > 4 && (
            <button
              onClick={() => setExpanded(true)}
              className="text-xs text-muted-foreground hover:text-foreground mt-1"
            >
              +{run.phases.length - 4} more...
            </button>
          )}
          {expanded && run.phases.length > 4 && (
            <button
              onClick={() => setExpanded(false)}
              className="text-xs text-muted-foreground hover:text-foreground mt-1"
            >
              collapse
            </button>
          )}
        </div>

        {/* Progress bar */}
        {totalCount > 0 && <ProgressBar completed={completedCount} total={totalCount} />}

        {/* Actions */}
        {onOpenActivity && (
          <div className="flex justify-end mt-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={() => onOpenActivity(record.sourceMessageId || '')}
            >
              {'查看详情'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function parseTeamPlanBlock(text: string): {
  beforeText: string;
  planContent: string;
  afterText: string;
} | null {
  const regex = /```lumos-team-plan\s*\n?([\s\S]*?)\n?\s*```/;
  const match = text.match(regex);
  if (!match) return null;
  const beforeText = text.slice(0, match.index).trim();
  const afterText = text.slice((match.index || 0) + match[0].length).trim();
  return { beforeText, planContent: match[1].trim(), afterText };
}
