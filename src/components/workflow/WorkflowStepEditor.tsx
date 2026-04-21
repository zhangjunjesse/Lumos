'use client';

import { AgentEditor } from './step-editors/agent-editor';
import { ApprovalEditor } from './step-editors/approval-editor';
import { CapabilityEditor } from './step-editors/capability-editor';
import { ForEachEditor } from './step-editors/for-each-editor';
import { IfElseEditor } from './step-editors/if-else-editor';
import { JoinEditor } from './step-editors/join-editor';
import { NotificationEditor } from './step-editors/notification-editor';
import { ParallelEditor } from './step-editors/parallel-editor';
import { WaitEditor } from './step-editors/wait-editor';
import { WhileEditor } from './step-editors/while-editor';
import type { WorkflowStepEditorProps } from './step-editors/step-editor-shared';

export function WorkflowStepEditor(props: WorkflowStepEditorProps) {
  switch (props.node.type) {
    case 'agent':
      return <AgentEditor {...props} />;
    case 'if-else':
      return <IfElseEditor {...props} />;
    case 'for-each':
      return <ForEachEditor {...props} />;
    case 'while':
      return <WhileEditor {...props} />;
    case 'wait':
      return <WaitEditor {...props} />;
    case 'notification':
      return <NotificationEditor {...props} />;
    case 'capability':
      return <CapabilityEditor {...props} />;
    case 'approval':
      return <ApprovalEditor {...props} />;
    case 'parallel':
      return <ParallelEditor {...props} />;
    case 'join':
      return <JoinEditor {...props} />;
    default:
      return null;
  }
}
