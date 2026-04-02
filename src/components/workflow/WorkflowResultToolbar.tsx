'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface WorkflowResultToolbarProps {
  name: string;
  stepCount: number;
  savedWorkflowId: string | null;
  saving: boolean;
  saveMsg: string;
  validForActions: boolean;
  onSave: () => void;
  onSaveAsTemplate?: () => void;
  onSaveToSchedule?: () => void;
}

export function WorkflowResultToolbar({
  name,
  stepCount,
  savedWorkflowId,
  saving,
  saveMsg,
  validForActions,
  onSave,
  onSaveAsTemplate,
  onSaveToSchedule,
}: WorkflowResultToolbarProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="font-medium text-sm">{name}</div>
        <div className="text-xs text-muted-foreground">{stepCount} 个步骤</div>
        {savedWorkflowId && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">已保存</Badge>
        )}
      </div>
      <div className="flex gap-2 items-center">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onSave} disabled={saving}>
          {saving ? '保存中...' : savedWorkflowId ? '更新' : '保存工作流'}
        </Button>
        {saveMsg && <span className="text-xs text-muted-foreground">{saveMsg}</span>}
        {onSaveAsTemplate && validForActions && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onSaveAsTemplate}>
            保存为模板
          </Button>
        )}
        {onSaveToSchedule && validForActions && (
          <Button size="sm" className="h-7 text-xs" onClick={onSaveToSchedule}>
            创建定时任务
          </Button>
        )}
      </div>
    </div>
  );
}
