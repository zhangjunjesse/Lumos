import { compileWorkflowDsl, generateWorkflow } from '../compiler';
import {
  DEFAULT_AGENT_STEP_TIMEOUT_MS,
  DEFAULT_NOTIFICATION_STEP_TIMEOUT_MS,
  DEFAULT_STEP_MAXIMUM_ATTEMPTS,
} from '../compiler-helpers';

describe('workflow compiler runtime context', () => {
  test('compiler injects stable workflow runtime context into generated steps', () => {
    const code = compileWorkflowDsl({
      version: 'v1',
      name: 'runtime-context-test',
      steps: [
        {
          id: 'draft',
          type: 'agent',
          input: {
            prompt: 'Draft a response',
            role: 'coder',
          },
        },
        {
          id: 'notify',
          type: 'notification',
          dependsOn: ['draft'],
          input: {
            message: 'Done',
          },
        },
      ],
    });

    expect(code).toContain('function __attachRuntimeContext(value, runtimeContext)');
    expect(code).toContain('function __resolveRuntimeContext(input, baseRuntimeContext)');
    expect(code).toContain('const reserved = input.__lumosRuntime;');
    expect(code).toContain('notificationStep,');
    expect(code).toContain('capabilityStep,');
    expect(code).toContain('waitStep,');
    expect(code).toContain(`{ workflowRunId: run.id, stepId: "draft", stepType: "agent", timeoutMs: ${DEFAULT_AGENT_STEP_TIMEOUT_MS} }`);
    expect(code).toContain(`{ workflowRunId: run.id, stepId: "notify", stepType: "notification", timeoutMs: ${DEFAULT_NOTIFICATION_STEP_TIMEOUT_MS} }`);
    expect(code).toContain(`retryPolicy":{"maximumAttempts":${DEFAULT_STEP_MAXIMUM_ATTEMPTS}}`);
    expect(code).toContain('runtimeContext.sessionId = reserved.sessionId;');
    expect(code).toContain('runtimeContext.requestedModel = reserved.requestedModel;');
  });

  test('compiler resolves steps.<id>.output references against upstream step output payload', () => {
    const code = compileWorkflowDsl({
      version: 'v1',
      name: 'step-output-reference-test',
      steps: [
        {
          id: 'analyze',
          type: 'agent',
          input: {
            prompt: 'Analyze task',
            role: 'researcher',
          },
        },
        {
          id: 'main',
          type: 'agent',
          dependsOn: ['analyze'],
          input: {
            prompt: 'steps.analyze.output.summary',
            role: 'worker',
          },
        },
      ],
    });

    expect(code).toContain("const stepMatch = /^steps\\.([A-Za-z0-9_-]+)(?:\\.(success|error|output|metadata)(?:\\.(.+))?)?$/.exec(ref);");
    expect(code).toContain("const stepOutput = stepResult.output;");
    expect(code).toContain("return __getByPath(stepOutput, stepMatch[3].split('.'));");
  });

  test('generateWorkflow keeps worker/coder roles valid and preserves stable manifest stepIds', () => {
    const artifact = generateWorkflow({
      spec: {
        version: 'v1',
        name: 'worker-role-test',
        steps: [
          {
            id: 'main',
            type: 'agent',
            input: {
              prompt: 'Complete the task',
              role: 'worker',
            },
          },
        ],
      },
    });

    expect(artifact.validation.valid).toBe(true);
    expect(artifact.manifest.stepIds).toEqual(['main']);
    expect(artifact.manifest.stepTimeoutsMs).toEqual([DEFAULT_AGENT_STEP_TIMEOUT_MS]);
  });

  test('compiler preserves explicit retry attempts when DSL overrides the default', () => {
    const code = compileWorkflowDsl({
      version: 'v1',
      name: 'retry-override-test',
      steps: [
        {
          id: 'retryable',
          type: 'agent',
          input: {
            prompt: 'Retry me',
            role: 'worker',
          },
          policy: {
            retry: {
              maximumAttempts: 3,
            },
          },
        },
      ],
    });

    expect(code).toContain('retryPolicy":{"maximumAttempts":3}');
  });

});
