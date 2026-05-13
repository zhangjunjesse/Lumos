'use client';

import * as React from 'react';
import { CheckCircle2 } from 'lucide-react';

import type { AutoReplyRule } from './use-auto-reply-rules';

export function AutoReplyStatusBadge({
  status,
}: {
  status: AutoReplyRule['status'];
}): React.ReactElement {
  if (status === 'active') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="size-3" />
        已生效
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      待审核
    </span>
  );
}
