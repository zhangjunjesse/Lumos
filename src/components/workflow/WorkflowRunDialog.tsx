'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { WorkflowParamForm } from './WorkflowParamForm';
import type { WorkflowParamDef } from '@/lib/workflow/types';

interface WorkflowRunDialogProps {
  open: boolean;
  scheduleName: string;
  params: WorkflowParamDef[];
  defaultValues: Record<string, unknown>;
  onClose: () => void;
  onRun: (params: Record<string, unknown>) => void;
}

function toStringValues(raw: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, v !== undefined && v !== null ? String(v) : ''])
  );
}

export function WorkflowRunDialog({
  open, scheduleName, params, defaultValues, onClose, onRun,
}: WorkflowRunDialogProps) {
  const [values, setValues] = useState<Record<string, string>>(() => toStringValues(defaultValues));
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) { setValues(toStringValues(defaultValues)); setErrors({}); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleRun() {
    const newErrors: Record<string, string> = {};
    for (const p of params) {
      const raw = values[p.name];
      if (p.required && p.default === undefined && (!raw || raw === '')) {
        newErrors[p.name] = '必填';
      }
    }
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }

    const coerced: Record<string, unknown> = {};
    for (const p of params) {
      const raw = values[p.name];
      if (raw === undefined || raw === '') {
        if (p.default !== undefined) coerced[p.name] = p.default;
        continue;
      }
      coerced[p.name] = p.type === 'number' ? Number(raw)
        : p.type === 'boolean' ? raw === 'true'
        : raw;
    }
    onRun(coerced);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle>运行「{scheduleName}」</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <p className="text-xs text-muted-foreground mb-4">
            填写本次运行的参数，留空将使用默认值。
            确保步骤 Prompt 中已用 <code className="bg-muted px-1 rounded">{'{{'}input.参数名{'}}'}</code> 引用参数，否则不会生效。
          </p>
          <WorkflowParamForm params={params} values={values} errors={errors} onChange={setValues} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleRun}>立即运行</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
