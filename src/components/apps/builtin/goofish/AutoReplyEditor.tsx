'use client';

import * as React from 'react';
import { CheckCircle2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

import { AutoReplyStatusBadge } from './AutoReplyStatusBadge';
import type { AutoReplyRule } from './use-auto-reply-rules';
import { formatAutoReplyTime } from './auto-reply-utils';

const CATEGORIES = ['问候', '现货', '物流', '价格', '售后', '其他'] as const;

export function AutoReplyEditor({
  rule,
  onPatch,
  onApprove,
  onDelete,
}: {
  rule: AutoReplyRule | null;
  onPatch: (patch: Partial<AutoReplyRule>) => void;
  onApprove: () => void;
  onDelete: () => void;
}): React.ReactElement {
  if (!rule) return <EditorEmpty />;
  const canApprove = rule.status === 'pending'
    && rule.trigger_pattern.trim().length > 0
    && rule.reply_template.trim().length > 0;
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <EditorHeader rule={rule} onPatch={onPatch} />
        <EditorFields rule={rule} onPatch={onPatch} />
        <EditorActions
          rule={rule}
          canApprove={canApprove}
          onPatch={onPatch}
          onApprove={onApprove}
          onDelete={onDelete}
        />
      </CardContent>
    </Card>
  );
}

function EditorEmpty(): React.ReactElement {
  return (
    <Card className="border-dashed">
      <CardContent className="flex min-h-64 items-center justify-center text-xs text-muted-foreground">
        从左侧选择一条话术，或点击「新增话术」创建草稿。
      </CardContent>
    </Card>
  );
}

function EditorFields({
  rule,
  onPatch,
}: {
  rule: AutoReplyRule;
  onPatch: (patch: Partial<AutoReplyRule>) => void;
}): React.ReactElement {
  return (
    <>
      <Field label="触发条件" required>
        <Input
          value={rule.trigger_pattern}
          onChange={(e) => onPatch({ trigger_pattern: e.target.value })}
          placeholder={rule.trigger_type === 'regex' ? '例如 ^还(在|有)\\s*\\?$' : '例如 还在吗'}
          className="font-mono text-xs"
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="触发类型">
          <Select
            value={rule.trigger_type}
            onValueChange={(v) => onPatch({ trigger_type: v as AutoReplyRule['trigger_type'] })}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="keyword">关键词</SelectItem>
              <SelectItem value="regex">正则</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="分类">
          <Select value={rule.category ?? '其他'} onValueChange={(v) => onPatch({ category: v })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="回复模板" required hint="支持 {buyer_name} {item_title} 占位符">
        <Textarea
          value={rule.reply_template}
          onChange={(e) => onPatch({ reply_template: e.target.value })}
          rows={4}
          className="resize-none text-sm"
          placeholder="您好 {buyer_name}，{item_title} 还在的，可以直接拍～"
        />
      </Field>
    </>
  );
}

function EditorHeader({
  rule,
  onPatch,
}: {
  rule: AutoReplyRule;
  onPatch: (patch: Partial<AutoReplyRule>) => void;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <AutoReplyStatusBadge status={rule.status} />
        <span className="text-[11px] tabular-nums text-muted-foreground">
          命中 {rule.match_count} 次
          {rule.last_matched_at ? ` · 上次 ${formatAutoReplyTime(rule.last_matched_at)}` : ''}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Label className="text-xs">启用</Label>
        <Switch
          checked={rule.enabled}
          onCheckedChange={(enabled) => onPatch({ enabled })}
        />
      </div>
    </div>
  );
}

function EditorActions({
  rule,
  canApprove,
  onPatch,
  onApprove,
  onDelete,
}: {
  rule: AutoReplyRule;
  canApprove: boolean;
  onPatch: (patch: Partial<AutoReplyRule>) => void;
  onApprove: () => void;
  onDelete: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
      <Button
        variant="ghost"
        size="sm"
        onClick={onDelete}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
        删除
      </Button>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPatch({ status: 'pending' })}
          disabled={rule.status === 'pending'}
        >
          保存为草稿
        </Button>
        <Button
          size="sm"
          onClick={onApprove}
          disabled={!canApprove}
          title={canApprove ? undefined : '请先填写触发条件和回复模板'}
        >
          <CheckCircle2 className="size-3.5" />
          {rule.status === 'active' ? '已审核通过' : '保存并审核通过'}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
        {required ? <span className="text-destructive">*</span> : null}
        {hint ? <span className="ml-2 normal-case tracking-normal text-[11px] text-muted-foreground/80">{hint}</span> : null}
      </Label>
      {children}
    </div>
  );
}
