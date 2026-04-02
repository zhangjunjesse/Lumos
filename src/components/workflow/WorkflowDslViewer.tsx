'use client';

import { Textarea } from '@/components/ui/textarea';

interface WorkflowDslViewerProps {
  dslText: string;
  editMode: boolean;
  onEdit: (text: string) => void;
  onToggleEdit: () => void;
  onValidate: () => void;
  minHeight?: number;
}

export function WorkflowDslViewer({
  dslText, editMode, onEdit, onToggleEdit, onValidate, minHeight = 200,
}: WorkflowDslViewerProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium">工作流 DSL</span>
        <div className="flex gap-3">
          <button type="button" onClick={onToggleEdit} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            {editMode ? '收起编辑' : '编辑'}
          </button>
          {editMode && (
            <button type="button" onClick={onValidate} className="text-xs text-primary hover:underline">验证</button>
          )}
        </div>
      </div>
      {editMode ? (
        <Textarea
          value={dslText}
          onChange={e => onEdit(e.target.value)}
          className="font-mono text-xs"
          style={{ minHeight }}
        />
      ) : (
        <pre
          className="text-xs bg-muted/50 rounded-lg p-3 overflow-auto text-muted-foreground border border-border/30"
          style={{ maxHeight: minHeight + 200, minHeight: Math.min(minHeight, 200) }}
        >
          {dslText}
        </pre>
      )}
    </div>
  );
}
