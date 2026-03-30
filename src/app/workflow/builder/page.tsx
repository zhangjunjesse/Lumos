'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WorkflowBuilderPanel } from '@/components/workflow/WorkflowBuilderPanel';

interface WorkflowDslResult {
  version: string;
  name: string;
  steps: unknown[];
}

export default function WorkflowBuilderPage() {
  const router = useRouter();
  const [schedulePending, setSchedulePending] = useState(false);

  const handleSaveToSchedule = useCallback(async (dsl: WorkflowDslResult) => {
    if (schedulePending) return;
    setSchedulePending(true);
    try {
      const res = await fetch('/api/workflow/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: dsl.name || '新定时工作流',
          workflowDsl: dsl,
          intervalMinutes: 60,
          notifyOnComplete: true,
        }),
      });
      if (res.ok) {
        router.push('/workflow/schedules');
      }
    } finally {
      setSchedulePending(false);
    }
  }, [router, schedulePending]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-8">
      <WorkflowBuilderPanel onSaveToSchedule={handleSaveToSchedule} />
    </div>
  );
}
