'use client';

import { GenericNodeEditor } from './generic-node-editor';
import type { WorkflowStepEditorProps } from './step-editor-shared';

export function JoinEditor(props: WorkflowStepEditorProps) {
  return <GenericNodeEditor {...props} />;
}
