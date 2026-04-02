import { compileWorkflowDsl, generateWorkflow } from '../compiler';
import { handleGenerateWorkflowTool } from '../mcp-tool';

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
    expect(code).toContain('{ workflowRunId: run.id, stepId: "draft", stepType: "agent", timeoutMs: undefined }');
    expect(code).toContain('{ workflowRunId: run.id, stepId: "notify", stepType: "notification", timeoutMs: undefined }');
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

    expect(code).toContain("const stepMatch = /^steps\\.([A-Za-z0-9_-]+)\\.(output)(?:\\.(.+))?$/.exec(ref);");
    expect(code).toContain("const stepOutput = stepResult && typeof stepResult === 'object' ? stepResult.output : undefined;");
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
  });

});
