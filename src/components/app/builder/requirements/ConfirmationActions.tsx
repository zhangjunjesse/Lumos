'use client';

import * as React from 'react';
import { CheckCircle2, PauseCircle, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { BuilderStoryStatus } from '@/lib/app/builder/session';

import { isConfirmedStatus } from './status-meta';

export function ConfirmationActions({
  status,
  saving,
  onChangeStatus,
}: {
  status: BuilderStoryStatus;
  saving: boolean;
  onChangeStatus: (status: BuilderStoryStatus) => void;
}): React.ReactElement {
  if (status === 'deferred') {
    return (
      <button
        type="button"
        onClick={() => onChangeStatus('pending_confirmation')}
        disabled={saving}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        <RotateCcw className="size-3" />
        重新启用
      </button>
    );
  }

  if (isConfirmedStatus(status)) {
    return (
      <button
        type="button"
        onClick={() => onChangeStatus('pending_confirmation')}
        disabled={saving}
        className="text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        重新待确认
      </button>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        size="sm"
        onClick={() => onChangeStatus('confirmed')}
        disabled={saving}
        className="h-7 px-2.5 text-xs"
      >
        <CheckCircle2 data-icon="inline-start" className="size-3" />
        确认
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onChangeStatus('deferred')}
        disabled={saving}
        className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <PauseCircle data-icon="inline-start" className="size-3" />
        暂不做
      </Button>
    </div>
  );
}
