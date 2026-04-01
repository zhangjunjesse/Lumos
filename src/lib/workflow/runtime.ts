import { agentStep } from './steps/agentStep';
import type {
  AgentStepInput,
  WaitStepInput,
  StepResult,
  WorkflowStepLifecycleEvent,
  WorkflowRuntimeBindings,
  WorkflowStepType,
} from './types';
// WorkflowStepType is used in the satisfies constraint below

interface StepRuntimeDefinition<TInput extends object> {
  type: WorkflowStepType;
  execute: (input: TInput) => Promise<StepResult>;
}

export const STEP_RUNTIME_REGISTRY = {
  agent: {
    type: 'agent',
    execute: (input: AgentStepInput) => agentStep(input),
  },
  wait: {
    type: 'wait',
    execute: async (input: { durationMs?: number }) => {
      await new Promise<void>(resolve => setTimeout(resolve, Math.max(0, input.durationMs ?? 1000)));
      return { success: true, output: { durationMs: input.durationMs ?? 1000 } };
    },
  },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Partial<Record<WorkflowStepType, StepRuntimeDefinition<any>>>;

export function createWorkflowRuntimeBindings(): WorkflowRuntimeBindings {
  return {
    agentStep: (input) => STEP_RUNTIME_REGISTRY.agent.execute(input),
    waitStep: (input: WaitStepInput) => STEP_RUNTIME_REGISTRY.wait.execute(input),
  };
}

export function createInstrumentedWorkflowRuntimeBindings(options: {
  onStepStarted?: (event: WorkflowStepLifecycleEvent) => Promise<void> | void;
  onStepCompleted?: (event: WorkflowStepLifecycleEvent) => Promise<void> | void;
  onStepSkipped?: (event: WorkflowStepLifecycleEvent) => Promise<void> | void;
} = {}): WorkflowRuntimeBindings {
  return {
    ...createWorkflowRuntimeBindings(),
    onStepStarted: options.onStepStarted,
    onStepCompleted: options.onStepCompleted,
    onStepSkipped: options.onStepSkipped,
  };
}
