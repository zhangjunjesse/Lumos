'use client';

import * as React from 'react';
import { ExternalLink } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

import {
  SOURCE_KIND_LABEL,
  type ResearchBriefRow,
  type ResearchEvidenceRow,
  type ResearchGoalRow,
  type ResearchQuestionRow,
  type ResearchReportRow,
  type ResearchRiskRow,
  type ResearchSourceRow,
} from '../deep-research-types';

export function EmptyHint({ text }: { text: string }): React.ReactElement {
  return <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">{text}</div>;
}

export function BriefCard({ brief }: { brief: ResearchBriefRow }): React.ReactElement {
  return (
    <div className="space-y-2 rounded-md border bg-card p-3 text-xs">
      <div className="flex items-center justify-between">
        <Badge variant={brief.status === 'accepted' ? 'secondary' : 'outline'}>{brief.status}</Badge>
        {brief.accepted_at && (
          <span className="text-muted-foreground">接受于 {brief.accepted_at}</span>
        )}
      </div>
      {brief.audience && <div>读者：{brief.audience}</div>}
      {brief.purpose && <div>用途：{brief.purpose}</div>}
      {brief.scope_in && <div>包含：{brief.scope_in}</div>}
      {brief.scope_out && <div>不含：{brief.scope_out}</div>}
      {brief.depth_target && <div>深度：{brief.depth_target}</div>}
      {brief.tone && <div>语气：{brief.tone}</div>}
    </div>
  );
}

export function GoalCard({ goal }: { goal: ResearchGoalRow }): React.ReactElement {
  return (
    <div className="space-y-2 rounded-md border bg-card p-3 text-xs">
      <Badge variant={goal.status === 'accepted' ? 'secondary' : 'outline'}>{goal.status}</Badge>
      {goal.smart_goal && <div>SMART 目标：{goal.smart_goal}</div>}
      {goal.success_criteria && <div>成功标准：{goal.success_criteria}</div>}
      {goal.out_of_scope && <div>明确不做：{goal.out_of_scope}</div>}
    </div>
  );
}

export function QuestionList({ questions }: { questions: ResearchQuestionRow[] }): React.ReactElement {
  const top = questions.filter((q) => !q.parent_ref);
  return (
    <ul className="space-y-1.5 text-xs">
      {top.map((q) => (
        <li key={q.id} className="flex items-start gap-2">
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {q.status ?? 'draft'}
          </Badge>
          <div className="min-w-0 flex-1">
            <div className="font-medium">{q.question}</div>
            {q.verification_criteria && (
              <div className="text-muted-foreground">验证标准：{q.verification_criteria}</div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function RiskList({ risks }: { risks: ResearchRiskRow[] }): React.ReactElement {
  return (
    <ul className="space-y-1.5 text-xs">
      {risks.map((r) => (
        <li key={r.id} className="flex items-start gap-2">
          <Badge
            variant={r.severity === 'critical' || r.severity === 'high' ? 'destructive' : 'outline'}
            className="shrink-0 text-[10px]"
          >
            {r.category} · {r.severity}
          </Badge>
          <div className="min-w-0 flex-1">
            <div>{r.description}</div>
            {r.mitigation && <div className="text-muted-foreground">降级：{r.mitigation}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SourceList({
  sources,
  emptyHint,
}: {
  sources: ResearchSourceRow[];
  emptyHint?: string;
}): React.ReactElement {
  if (sources.length === 0) {
    return (
      <EmptyHint
        text={
          emptyHint ??
          '尚未订阅任何采集来源。先订阅 ≥2 个不同来源（如 deepsearch 公网 + 抖音 + bilibili）再启动采集。'
        }
      />
    );
  }
  return (
    <ul className="space-y-1.5 text-xs">
      {sources.map((s) => (
        <li key={s.id} className="flex items-start gap-2">
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {SOURCE_KIND_LABEL[s.kind ?? ''] ?? s.kind} · {s.status}
          </Badge>
          <div className="min-w-0 flex-1">
            <div className="truncate">{s.target}</div>
            {s.last_failure_reason && (
              <div className="text-amber-700 dark:text-amber-400">{s.last_failure_reason}</div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function EvidenceList({
  evidence,
}: {
  evidence: ResearchEvidenceRow[];
}): React.ReactElement {
  return (
    <ul className="space-y-1.5 text-xs">
      {evidence.map((e) => (
        <li key={e.id} className="flex items-start gap-2">
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {e.source_kind} · {e.confidence}
          </Badge>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{e.title || '（无标题）'}</div>
            {e.url && (
              <a
                href={e.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-muted-foreground hover:underline"
              >
                {e.url}
                <ExternalLink className="size-3" />
              </a>
            )}
            {e.snippet && <div className="line-clamp-2 text-muted-foreground">{e.snippet}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ReportList({ reports }: { reports: ResearchReportRow[] }): React.ReactElement {
  return (
    <ul className="space-y-1.5 text-xs">
      {reports.map((r) => (
        <li key={r.id} className="flex items-start gap-2">
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {r.kind} v{r.version ?? 1} · {r.status}
          </Badge>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{r.title || '（未命名）'}</div>
            {r.qa_summary && <div className="text-muted-foreground">自检：{r.qa_summary}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}
