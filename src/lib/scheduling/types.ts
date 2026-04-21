import type { Task, UpdateTaskStatusRequest } from '@/lib/task-management/types';
import type { WorkflowDSLV3 } from '@/lib/workflow/types-v3';
import type {
  SchedulingPlanAnalysis,
  SchedulingPlanDiagnostics,
  SchedulingPlanSource,
  SchedulingStrategy,
} from './planner';

export interface SchedulingPreview {
  source: SchedulingPlanSource;
  reason: string;
  analysis: SchedulingPlanAnalysis;
  model?: string;
  diagnostics?: SchedulingPlanDiagnostics;
  workflowDsl?: WorkflowDSLV3;
}

export interface AcceptTaskRequest {
  taskId: string;
  task: Task;
}

export interface AcceptTaskResponse {
  accepted: boolean;
  strategy?: SchedulingStrategy;
  workflowId?: string;
  estimatedDuration?: number;
  planning?: SchedulingPreview;
  message?: string;
}

export interface SchedulingCallbacks {
  onTaskStatusUpdate: (request: UpdateTaskStatusRequest) => void;
}
