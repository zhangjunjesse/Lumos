'use client';

import { GenericNodeEditor } from './generic-node-editor';
import type { WorkflowStepEditorProps } from './step-editor-shared';

export function ParallelEditor(props: WorkflowStepEditorProps) {
  return <GenericNodeEditor {...props} />;
}
