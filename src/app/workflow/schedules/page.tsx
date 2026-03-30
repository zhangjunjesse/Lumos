'use client';

import { useCallback, useState } from 'react';
import { ScheduleList, type ScheduledWorkflow } from '@/components/workflow/ScheduleList';
import { ScheduleEditor } from '@/components/workflow/ScheduleEditor';

export default function SchedulesPage() {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ScheduledWorkflow | null>(null);
  const [listKey, setListKey] = useState(0);

  const handleNew = useCallback(() => {
    setEditTarget(null);
    setEditorOpen(true);
  }, []);

  const handleEdit = useCallback((schedule: ScheduledWorkflow) => {
    setEditTarget(schedule);
    setEditorOpen(true);
  }, []);

  const handleSaved = useCallback(() => {
    setListKey(k => k + 1);
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-8">
      <ScheduleList key={listKey} onNew={handleNew} onEdit={handleEdit} />
      <ScheduleEditor
        open={editorOpen}
        initial={editTarget}
        onClose={() => setEditorOpen(false)}
        onSave={handleSaved}
      />
    </div>
  );
}
