'use client';

import { GenericNodeEditor } from './generic-node-editor';
import type { WorkflowStepEditorProps } from './step-editor-shared';

export function CapabilityEditor(props: WorkflowStepEditorProps) {
  return <GenericNodeEditor {...props} />;
}
