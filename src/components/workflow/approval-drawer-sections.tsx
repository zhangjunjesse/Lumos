'use client';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { ApprovalRequest } from '@/lib/workflow/approval-requests';

function formatApproverHint(mode: string, count: number, quorum: number | undefined): string {
  if (mode === 'all') return `需 ${count} 人全部通过`;
  if (mode === 'quorum') return `${count} 人中需 ${quorum ?? '?'} 人通过`;
  return `${count} 人中任一通过即可`;
}

function formatCountdown(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return '已过期';
  if (ms < 60_000) return `${Math.floor(ms / 1000)} 秒后超时`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)} 分钟后超时`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3600_000)} 小时后超时`;
  return `${Math.floor(ms / 86_400_000)} 天后超时`;
}

export function ApprovalSummary({ approval }: { approval: ApprovalRequest }) {
  const countdown = formatCountdown(approval.timeoutAt);
  return (
    <>
      <section>
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">提示</p>
        <p className="text-sm whitespace-pre-wrap">{approval.prompt || '(无)'}</p>
      </section>

      <section>
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">审批人</p>
        <p className="text-sm">
          {formatApproverHint(approval.approvers.mode, approval.approvers.users.length, approval.approvers.quorum)}
        </p>
        <ul className="mt-1 space-y-0.5">
          {approval.approvers.users.map((u) => {
            const d = approval.decisions.find((x) => x.decidedBy === u);
            return (
              <li key={u} className="text-xs flex items-center gap-2">
                <span className="text-foreground">{u}</span>
                {d ? (
                  <span className={d.decision === 'approved' ? 'text-emerald-600' : 'text-destructive'}>
                    · {d.decision === 'approved' ? '已通过' : '已拒绝'}
                  </span>
                ) : (
                  <span className="text-muted-foreground">· 待决策</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {countdown && (
        <section>
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">超时</p>
          <p className="text-sm">{countdown}</p>
        </section>
      )}
    </>
  );
}

export function ApprovalResolvedDetail({ approval }: { approval: ApprovalRequest }) {
  return (
    <section className="rounded-md border border-border/60 bg-muted/30 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">最终状态</p>
      <p className="text-sm font-medium">{approval.status}</p>
      {approval.finalNote && (
        <p className="text-xs text-muted-foreground mt-1">备注: {approval.finalNote}</p>
      )}
    </section>
  );
}

export function ApprovalPendingForm({
  approval, decidedBy, setDecidedBy, note, setNote, payloadText, setPayloadText,
}: {
  approval: ApprovalRequest;
  decidedBy: string;
  setDecidedBy: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  payloadText: string;
  setPayloadText: (v: string) => void;
}) {
  return (
    <>
      <section className="space-y-1.5">
        <Label htmlFor="approval-decided-by">决策人</Label>
        <Input
          id="approval-decided-by"
          value={decidedBy}
          onChange={(e) => setDecidedBy(e.target.value)}
          placeholder={`必须来自审批人列表 (${approval.approvers.users.join(', ') || '无'})`}
        />
      </section>

      <section className="space-y-1.5">
        <Label htmlFor="approval-note">备注</Label>
        <Textarea
          id="approval-note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="可选"
        />
      </section>

      {approval.formSchema && (
        <section className="space-y-1.5">
          <Label htmlFor="approval-payload">payload (JSON)</Label>
          <p className="text-xs text-muted-foreground">
            改动这里等于「改参数继续」, 会作为 {`{{ steps.${approval.stepId}.output }}`} 注入后续步骤
          </p>
          <Textarea
            id="approval-payload"
            rows={6}
            value={payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
            className="font-mono text-xs"
            placeholder={JSON.stringify(approval.formSchema, null, 2)}
          />
        </section>
      )}
    </>
  );
}
