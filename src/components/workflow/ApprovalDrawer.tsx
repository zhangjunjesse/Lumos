'use client';

import { useCallback, useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import type { ApprovalRequest } from '@/lib/workflow/approval-requests';
import {
  ApprovalPendingForm,
  ApprovalResolvedDetail,
  ApprovalSummary,
} from './approval-drawer-sections';

interface ApprovalDrawerProps {
  approvalId: string | null;
  onOpenChange: (open: boolean) => void;
  onResolved?: (approval: ApprovalRequest) => void;
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; approval: ApprovalRequest }
  | { status: 'error'; message: string };

export function ApprovalDrawer({ approvalId, onOpenChange, onResolved }: ApprovalDrawerProps) {
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const [decidedBy, setDecidedBy] = useState('');
  const [note, setNote] = useState('');
  const [payloadText, setPayloadText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!approvalId) {
      setState({ status: 'idle' });
      setDecidedBy('');
      setNote('');
      setPayloadText('');
      setSubmitError('');
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    (async () => {
      try {
        const res = await fetch(`/api/workflows/approvals/${approvalId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ApprovalRequest;
        if (cancelled) return;
        setState({ status: 'loaded', approval: data });
        setPayloadText(data.finalPayload ? JSON.stringify(data.finalPayload, null, 2) : '');
      } catch (err) {
        if (cancelled) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : 'load failed' });
      }
    })();
    return () => { cancelled = true; };
  }, [approvalId]);

  const submit = useCallback(async (decision: 'approved' | 'rejected') => {
    if (state.status !== 'loaded') return;
    if (!decidedBy.trim()) { setSubmitError('请填写决策人'); return; }
    setSubmitError('');
    let payload: unknown;
    const trimmedPayload = payloadText.trim();
    if (trimmedPayload) {
      try { payload = JSON.parse(trimmedPayload); }
      catch { setSubmitError('payload 不是合法 JSON'); return; }
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/workflows/approvals/${state.approval.id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decidedBy: decidedBy.trim(), decision, note: note.trim() || undefined, payload }),
      });
      const data = await res.json() as { approval?: ApprovalRequest; error?: string };
      if (!res.ok || !data.approval) throw new Error(data.error ?? `HTTP ${res.status}`);
      onResolved?.(data.approval);
      if (data.approval.status !== 'pending') onOpenChange(false);
      else setState({ status: 'loaded', approval: data.approval });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'submit failed');
    } finally {
      setSubmitting(false);
    }
  }, [state, decidedBy, note, payloadText, onOpenChange, onResolved]);

  const loaded = state.status === 'loaded' ? state.approval : null;
  const pending = loaded?.status === 'pending';

  return (
    <Sheet open={approvalId !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md w-[28rem]">
        <SheetHeader>
          <SheetTitle>审批详情</SheetTitle>
          <SheetDescription>
            {loaded ? `步骤 ${loaded.stepId} · 运行 ${loaded.workflowRunId.slice(0, 8)}` : ' '}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-2 space-y-4">
          {state.status === 'loading' && <p className="text-sm text-muted-foreground">加载中...</p>}
          {state.status === 'error' && (
            <p className="text-sm text-destructive">加载失败: {state.message}</p>
          )}
          {loaded && (
            <>
              <ApprovalSummary approval={loaded} />
              {loaded.status !== 'pending' && <ApprovalResolvedDetail approval={loaded} />}
              {loaded.status === 'pending' && (
                <ApprovalPendingForm
                  approval={loaded}
                  decidedBy={decidedBy}
                  setDecidedBy={setDecidedBy}
                  note={note}
                  setNote={setNote}
                  payloadText={payloadText}
                  setPayloadText={setPayloadText}
                />
              )}
            </>
          )}
        </div>

        {pending && (
          <SheetFooter>
            {submitError && <p className="text-xs text-destructive">{submitError}</p>}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                关闭
              </Button>
              <Button
                variant="destructive"
                onClick={() => submit('rejected')}
                disabled={submitting}
              >
                拒绝
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => submit('approved')}
                disabled={submitting}
              >
                {payloadText.trim() ? '改参数批准' : '批准'}
              </Button>
            </div>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
