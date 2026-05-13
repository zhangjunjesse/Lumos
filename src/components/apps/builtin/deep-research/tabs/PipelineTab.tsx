'use client';

import * as React from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Circle } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { useAppCollection, useTaskScopedCollection } from '../use-app-data';
import {
  STAGE_LABEL,
  STAGE_ORDER,
  type ResearchBriefRow,
  type ResearchEvidenceRow,
  type ResearchGoalRow,
  type ResearchQuestionRow,
  type ResearchReportRow,
  type ResearchRiskRow,
  type ResearchSourceRow,
  type ResearchStage,
  type ResearchTaskRow,
} from '../deep-research-types';
import { STAGE_DEFS, type StageDef } from './stage-config';

interface PipelineTabProps {
  taskId: string | null;
  onBack: () => void;
}

export function PipelineTab({ taskId, onBack }: PipelineTabProps): React.ReactElement {
  const { rows: allTasks, update } = useAppCollection<ResearchTaskRow>('research_tasks');
  const task = React.useMemo(
    () => (taskId ? allTasks.find((t) => t.id === taskId) ?? null : null),
    [allTasks, taskId],
  );

  const briefs = useTaskScopedCollection<ResearchBriefRow>('research_briefs', taskId);
  const goals = useTaskScopedCollection<ResearchGoalRow>('research_goals', taskId);
  const questions = useTaskScopedCollection<ResearchQuestionRow>('research_questions', taskId);
  const risks = useTaskScopedCollection<ResearchRiskRow>('research_risks', taskId);
  const sources = useTaskScopedCollection<ResearchSourceRow>('research_sources', taskId);
  const evidence = useTaskScopedCollection<ResearchEvidenceRow>('research_evidence', taskId);
  const reports = useTaskScopedCollection<ResearchReportRow>('research_reports', taskId);

  if (!taskId) {
    return (
      <Alert>
        <AlertCircle className="size-4" />
        <AlertDescription>请先在「调研任务」中选择一个任务。</AlertDescription>
      </Alert>
    );
  }

  if (!task) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1.5 size-4" /> 返回任务列表
        </Button>
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>未找到任务 {taskId}。可能已被删除。</AlertDescription>
        </Alert>
      </div>
    );
  }

  const stage = task.stage ?? 'clarifying';
  const stageIndex = STAGE_ORDER.indexOf(stage);
  const data = {
    briefs: briefs.rows,
    goals: goals.rows,
    questions: questions.rows,
    risks: risks.rows,
    sources: sources.rows,
    evidence: evidence.rows,
    reports: reports.rows,
  };

  async function advance(target: ResearchStage): Promise<void> {
    await update(task!.id, {
      stage: target,
      last_advance_at: new Date().toISOString(),
      blocking_reason: '',
    });
  }

  async function pause(reason: string): Promise<void> {
    await update(task!.id, { status: 'paused', blocking_reason: reason });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1.5 size-4" /> 返回任务列表
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{task.title || '（未命名任务）'}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>当前阶段：{STAGE_LABEL[stage]}</span>
            {task.style && <span>· 风格：{task.style}</span>}
            {task.length_target && <span>· 长度：{task.length_target}</span>}
            {task.audience && <span>· 读者：{task.audience}</span>}
          </div>
        </div>
        <Badge variant={task.status === 'failed' ? 'destructive' : 'outline'}>
          {task.status ?? 'active'}
        </Badge>
      </div>

      <StageStepper currentStage={stage} />

      {task.blocking_reason && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>阻塞原因：{task.blocking_reason}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4">
        {STAGE_DEFS.map((def) => (
          <StageCard
            key={def.stageKey}
            def={def}
            data={data}
            currentStage={stage}
            stageIndex={stageIndex}
            onAdvance={advance}
            onPause={pause}
          />
        ))}
      </div>
    </div>
  );
}

function StageStepper({ currentStage }: { currentStage: ResearchStage }): React.ReactElement {
  const currentIdx = STAGE_ORDER.indexOf(currentStage);
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl bg-muted/30 p-3">
      {STAGE_ORDER.map((s, idx) => {
        const done = currentIdx > idx;
        const active = currentIdx === idx;
        return (
          <div key={s} className="flex items-center gap-1">
            {idx > 0 && <span className="text-muted-foreground">›</span>}
            <span
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${
                active
                  ? 'bg-sky-500 text-white'
                  : done
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200'
                  : 'bg-card text-muted-foreground'
              }`}
            >
              {done ? <CheckCircle2 className="size-3" /> : <Circle className="size-3" />}
              {STAGE_LABEL[s]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface StageCardProps {
  def: StageDef;
  data: Parameters<StageDef['renderBody']>[0];
  currentStage: ResearchStage;
  stageIndex: number;
  onAdvance: (target: ResearchStage) => Promise<void>;
  onPause: (reason: string) => Promise<void>;
}

function StageCard(props: StageCardProps): React.ReactElement {
  const { def, data, currentStage, stageIndex, onAdvance, onPause } = props;
  const active = currentStage === def.stageKey;
  const passed = STAGE_ORDER.indexOf(currentStage) > STAGE_ORDER.indexOf(def.stageKey);
  const { count, label } = def.countLabel(data);
  const canAdvance = def.canAdvance(data, stageIndex);
  return (
    <Card className={active ? 'ring-2 ring-sky-500' : passed ? 'opacity-70' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-sm">{def.title}</CardTitle>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{def.summary}</p>
          </div>
          <Badge
            variant={passed ? 'secondary' : active ? 'default' : 'outline'}
            className="shrink-0"
          >
            {count} {label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">{def.renderBody(data)}</div>
        {active && (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Button size="sm" disabled={!canAdvance} onClick={() => void onAdvance(def.nextStage)}>
              {def.actionLabel}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void onPause(`${STAGE_LABEL[def.stageKey]} 阶段用户暂停`)}
            >
              暂停任务
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
