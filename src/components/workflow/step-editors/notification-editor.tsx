'use client';

import { GenericNodeEditor } from './generic-node-editor';
import type { WorkflowStepEditorProps } from './step-editor-shared';

export function NotificationEditor(props: WorkflowStepEditorProps) {
  return <GenericNodeEditor {...props} />;
}
