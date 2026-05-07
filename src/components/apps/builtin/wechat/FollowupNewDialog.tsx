'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import type { Followup, FollowupType, Person } from './relations-types';

const TYPE_OPTIONS: { value: FollowupType; label: string }[] = [
  { value: 'reply', label: '待回复' },
  { value: 'commitment', label: '承诺' },
  { value: 'event', label: '事件' },
  { value: 'health', label: '健康' },
  { value: 'other', label: '其它' },
];

export function FollowupNewDialog({
  open,
  people,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  people: Person[];
  onOpenChange: (open: boolean) => void;
  onCreate: (draft: Omit<Followup, 'id' | 'createdAt' | 'updatedAt'>) => void;
}): React.ReactElement {
  const [title, setTitle] = React.useState('');
  const [type, setType] = React.useState<FollowupType>('other');
  const [summary, setSummary] = React.useState('');
  const [nextStep, setNextStep] = React.useState('');
  const [involved, setInvolved] = React.useState<string[]>([]);
  const [contactQuery, setContactQuery] = React.useState('');

  const selectedPeople = React.useMemo(
    () => involved
      .map((id) => people.find((person) => person.id === id))
      .filter((person): person is Person => Boolean(person)),
    [involved, people],
  );
  const contactResults = React.useMemo(() => {
    const query = contactQuery.trim().toLowerCase();
    const filtered = query
      ? people.filter((person) => {
          const haystack = `${person.name} ${person.remark ?? ''}`.toLowerCase();
          return haystack.includes(query);
        })
      : people;
    return filtered.slice(0, 24);
  }, [contactQuery, people]);

  const reset = () => {
    setTitle('');
    setType('other');
    setSummary('');
    setNextStep('');
    setInvolved([]);
    setContactQuery('');
  };

  const submit = () => {
    if (!title.trim()) return;
    onCreate({
      title: title.trim(),
      type,
      involvedPersonIds: involved,
      summary: summary.trim() || '（待补充）',
      nextStep: nextStep.trim() || '（待你定）',
      status: 'open',
      dialogueRefs: [],
      automationIds: [],
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-base font-medium tracking-tight">新建跟进</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              标题 <span className="text-destructive">*</span>
            </Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="如 国信付款催进展"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">类型</Label>
            <div className="flex flex-wrap gap-1">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setType(opt.value)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-[11px] transition-colors',
                    type === opt.value
                      ? 'border-foreground bg-foreground text-background'
                      : 'text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">涉及</Label>
              {involved.length > 0 ? (
                <span className="text-[11px] text-muted-foreground">{involved.length} / 20</span>
              ) : null}
            </div>
            {selectedPeople.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {selectedPeople.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setInvolved((prev) => prev.filter((x) => x !== p.id))}
                    className="rounded-full border border-foreground bg-foreground px-2.5 py-0.5 text-[11px] text-background transition-colors hover:opacity-80"
                  >
                    {p.name} ×
                  </button>
                ))}
              </div>
            ) : null}
            <Input
              value={contactQuery}
              onChange={(e) => setContactQuery(e.target.value)}
              placeholder="搜索联系人或群名"
            />
            <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto rounded-md border bg-card/40 p-2">
              {contactResults.length === 0 ? (
                <span className="px-1 py-1 text-xs text-muted-foreground">没有匹配联系人</span>
              ) : contactResults.map((p) => {
                const checked = involved.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={!checked && involved.length >= 20}
                    onClick={() =>
                      setInvolved((prev) =>
                        checked ? prev.filter((x) => x !== p.id) : [...prev, p.id],
                      )
                    }
                    className={cn(
                      'max-w-full truncate rounded-full border px-2.5 py-0.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                      checked
                        ? 'border-foreground bg-foreground text-background'
                        : 'text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                    )}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">概览</Label>
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={2}
              placeholder="一两句话说清楚是什么事"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">下一步</Label>
            <Input
              value={nextStep}
              onChange={(e) => setNextStep(e.target.value)}
              placeholder="比如 今晚 21:00 前给张总发条消息"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={!title.trim()}>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
