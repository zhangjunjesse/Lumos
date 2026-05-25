'use client';

import * as React from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { FulfillmentLogRow } from './use-fulfillment-log';

export function FulfillmentDetailDialog({
  row,
  onClose,
  onRetry,
}: {
  row: FulfillmentLogRow;
  onClose: () => void;
  onRetry: () => void | Promise<void>;
}): React.ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4">
      <div className="w-full max-w-lg rounded-xl border bg-card p-5 shadow-lg">
        <header className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold">发货详情</h3>
          <Button variant="ghost" size="xs" onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        </header>

        <dl className="mt-4 space-y-3 text-xs">
          <Row label="触发">
            {triggerLabel(row.trigger_source)} · {formatTime(row.created_at)}
          </Row>
          {row.detection_keyword ? (
            <Row label="命中关键词">「{row.detection_keyword}」</Row>
          ) : null}
          <Row label="买家">
            {row.buyer_name || '—'}
            {row.buyer_user_id ? (
              <span className="ml-1 font-mono text-muted-foreground">(uid: {row.buyer_user_id})</span>
            ) : null}
          </Row>
          <Row label="商品">{row.item_title || row.item_id || '—'}</Row>
          <Row label="商品（库内）">{row.product_title || row.product_id || '—'}</Row>
          <Row label="账号">{row.account_unb || '—'}</Row>
          <Row label="状态">{statusLabel(row.status)}</Row>
          {row.failure_reason ? (
            <Row label="失败原因">
              <span className="text-destructive">{row.failure_reason}</span>
            </Row>
          ) : null}
        </dl>

        <div className="mt-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            实际发出内容
          </p>
          <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/30 px-3 py-2 text-xs leading-5 [overflow-wrap:anywhere]">
            {row.sent_text || '（无）'}
          </pre>
        </div>

        <footer className="mt-5 flex justify-end gap-2">
          {row.status === 'failed' ? (
            <Button size="sm" onClick={() => void onRetry()}>重发</Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>
        </footer>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex-1 break-words [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function triggerLabel(source: string): string {
  if (source === 'auto_scan') return '自动扫描';
  if (source === 'manual_button') return '手动按钮';
  if (source === 'ai_in_chat') return 'AI 助手';
  return source;
}

function statusLabel(status: string): string {
  if (status === 'sent') return '已发';
  if (status === 'failed') return '失败';
  if (status === 'duplicate_skip') return '去重跳过';
  if (status === 'pending') return '待处理';
  return status;
}

function formatTime(iso?: string | null): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
