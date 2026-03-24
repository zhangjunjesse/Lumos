import { agentStep } from './steps/agentStep';
import { browserStep } from './steps/browserStep';
import { notificationStep } from './steps/notificationStep';
import { capabilityStep } from './steps/capabilityStep';
import type {
  AgentStepInput,
  BrowserStepInput,
  NotificationStepInput,
  StepResult,
  WorkflowStepLifecycleEvent,
  WorkflowRuntimeBindings,
  WorkflowStepType,
} from './types';
import type { CapabilityStepInput } from './steps/capabilityStep';

interface StepContext {
  stepType: WorkflowStepType;
}

interface StepRuntimeDefinition<TInput extends object> {
  type: WorkflowStepType;
  execute: (input: TInput, ctx: StepContext) => Promise<StepResult>;
}

export const STEP_RUNTIME_REGISTRY = {
  agent: {
    type: 'agent',
    execute: (input: AgentStepInput, _ctx: StepContext) => agentStep(input),
  },
  browser: {
    type: 'browser',
    execute: (input: BrowserStepInput, _ctx: StepContext) => browserStep(input),
  },
  notification: {
    type: 'notification',
    execute: (input: NotificationStepInput, _ctx: StepContext) => notificationStep(input),
  },
  capability: {
    type: 'capability',
    execute: (input: CapabilityStepInput, _ctx: StepContext) => capabilityStep(input),
  },
} satisfies Record<WorkflowStepType, StepRuntimeDefinition<any>>;

export function createWorkflowRuntimeBindings(): WorkflowRuntimeBindings {
  return {
    agentStep: (input) => STEP_RUNTIME_REGISTRY.agent.execute(input, { stepType: 'agent' }),
    browserStep: (input) => STEP_RUNTIME_REGISTRY.browser.execute(input, { stepType: 'browser' }),
    notificationStep: (input) =>
      STEP_RUNTIME_REGISTRY.notification.execute(input, { stepType: 'notification' }),
    capabilityStep: (input) =>
      STEP_RUNTIME_REGISTRY.capability.execute(input, { stepType: 'capability' }),
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
