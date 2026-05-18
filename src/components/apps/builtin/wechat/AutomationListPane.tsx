'use client';

import * as React from 'react';
import { Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

import { AutomationFormDialog, type AutomationDraft } from './AutomationFormDialog';
import { AutomationRow } from './AutomationRow';
import type { Automation, Followup } from './relations-types';

export function AutomationListPane({
  automations,
  followups,
  loading,
  saving,
  triggeringId,
  onUpdate,
  onDelete,
  onCreate,
  onTrigger,
}: {
  automations: Automation[];
  followups: Followup[];
  loading: boolean;
  saving: boolean;
  triggeringId: string | null;
  onUpdate: (id: string, patch: Partial<Automation>) => void;
  onDelete: (id: string) => void;
  onCreate: (draft: AutomationDraft) => Promise<Automation | null> | void;
  onTrigger: (id: string) => void;
}): React.ReactElement {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Automation | null>(null);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (automation: Automation) => {
    setEditing(automation);
    setDialogOpen(true);
  };

  const submit = React.useCallback(async (draft: AutomationDraft): Promise<boolean> => {
    if (editing) {
      onUpdate(editing.id, draft);
      return true;
    }
    const created = await onCreate(draft);
    return created !== null && created !== undefined;
  }, [editing, onCreate, onUpdate]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">提醒与定期任务</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            规则保存到本机；可执行的任务会接入调度，运行记录见下一个标签页。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saving ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              保存中
            </span>
          ) : null}
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-3.5" />
            新建
          </Button>
        </div>
      </div>

      {loading ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            加载自动化中…
          </CardContent>
        </Card>
      ) : automations.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-32 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            还没有自动化任务
            <Button size="sm" variant="outline" onClick={openCreate}>
              <Plus className="size-3.5" />
              新建第一个
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {automations.map((a) => (
            <AutomationRow
              key={a.id}
              automation={a}
              followups={followups}
              triggering={triggeringId === a.id}
              triggerBlocked={Boolean(triggeringId && triggeringId !== a.id)}
              onToggle={(enabled) => onUpdate(a.id, { enabled })}
              onEdit={() => openEdit(a)}
              onDelete={() => onDelete(a.id)}
              onTrigger={() => onTrigger(a.id)}
            />
          ))}
        </div>
      )}

      <AutomationFormDialog
        open={dialogOpen}
        mode={editing ? 'edit' : 'create'}
        automation={editing}
        saving={saving}
        onSubmit={submit}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
