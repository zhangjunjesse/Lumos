import { generateWorkflowFromDsl } from '../compiler';
import type { WorkflowDSLV2 } from '../types';

describe('v2 compiler — control flow', () => {
  const agentOnlyV2: WorkflowDSLV2 = {
    version: 'v2',
    name: 'agent-only-v2',
    steps: [
      { id: 'research', type: 'agent', input: { prompt: 'Research topic', role: 'researcher' } },
      { id: 'write', type: 'agent', dependsOn: ['research'], input: { prompt: 'Write report', role: 'worker', context: { research: 'steps.research.output.summary' } } },
    ],
  };

  test('compiles agent-only v2 DSL successfully', () => {
    const result = generateWorkflowFromDsl(agentOnlyV2);
    expect(result.validation.valid).toBe(true);
    expect(result.code).toContain('agentStep(');
    expect(result.manifest.dslVersion).toBe('v2');
    expect(result.manifest.stepIds).toEqual(['research', 'write']);
  });

  test('compiles if-else step with then and else branches', () => {
    const dsl: WorkflowDSLV2 = {
      version: 'v2',
      name: 'if-else-test',
      steps: [
        { id: 'fetch', type: 'agent', input: { prompt: 'Fetch data', role: 'worker' } },
        {
          id: 'check',
          type: 'if-else',
          dependsOn: ['fetch'],
          input: {
            condition: { op: 'gt', left: 'steps.fetch.output.count', right: 5 },
            then: ['deep-analysis'],
            else: ['brief'],
          },
        },
        { id: 'deep-analysis', type: 'agent', input: { prompt: 'Deep analysis', role: 'researcher' } },
        { id: 'brief', type: 'agent', input: { prompt: 'Brief summary', role: 'worker' } },
      ],
    };

    const result = generateWorkflowFromDsl(dsl);
    expect(result.validation.valid).toBe(true);
    expect(result.code).toContain('// if-else: check');
    expect(result.code).toContain('__evaluateCondition(');
    expect(result.code).toContain('} else {');
    expect(result.code).toContain('"deep-analysis"');
    expect(result.code).toContain('"brief"');
  });

  test('compiles for-each step with body', () => {
    const dsl: WorkflowDSLV2 = {
      version: 'v2',
      name: 'for-each-test',
      steps: [
        { id: 'crawl', type: 'agent', input: { prompt: 'Crawl pages', role: 'worker' } },
        {
          id: 'process-all',
          type: 'for-each',
          dependsOn: ['crawl'],
          input: {
            collection: 'steps.crawl.output.articles',
            itemVar: 'article',
            body: ['analyze'],
            maxIterations: 10,
          },
        },
        { id: 'analyze', type: 'agent', input: { prompt: 'Analyze article', role: 'researcher' } },
      ],
    };

    const result = generateWorkflowFromDsl(dsl);
    expect(result.validation.valid).toBe(true);
    expect(result.code).toContain('// for-each: process-all');
    expect(result.code).toContain('__resolveRef("steps.crawl.output.articles"');
    expect(result.code).toContain('Math.min(');
    expect(result.code).toContain(', 10)');
    expect(result.code).toContain('article:');
  });

  test('compiles while step with body and max iterations', () => {
    const dsl: WorkflowDSLV2 = {
      version: 'v2',
      name: 'while-test',
      steps: [
        { id: 'init', type: 'agent', input: { prompt: 'Initialize', role: 'worker' } },
        {
          id: 'paginate',
          type: 'while',
          dependsOn: ['init'],
          input: {
            condition: { op: 'exists', ref: 'steps.init.output.hasMore' },
            body: ['fetch-page'],
            maxIterations: 5,
          },
        },
        { id: 'fetch-page', type: 'agent', input: { prompt: 'Fetch next page', role: 'worker' } },
      ],
    };

    const result = generateWorkflowFromDsl(dsl);
    expect(result.validation.valid).toBe(true);
    expect(result.code).toContain('// while: paginate');
    expect(result.code).toContain('__iter_paginate < 5');
    expect(result.code).toContain('__iter_paginate++');
  });

  test('rejects duplicate step ownership across control flow', () => {
    const dsl: WorkflowDSLV2 = {
      version: 'v2',
      name: 'bad-ownership',
      steps: [
        {
          id: 'branch-a',
          type: 'if-else',
          input: { condition: { op: 'exists', ref: 'input.flag' }, then: ['shared'] },
        },
        {
          id: 'branch-b',
          type: 'if-else',
          input: { condition: { op: 'exists', ref: 'input.flag2' }, then: ['shared'] },
        },
        { id: 'shared', type: 'agent', input: { prompt: 'Shared step', role: 'worker' } },
      ],
    };

    const result = generateWorkflowFromDsl(dsl);
    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors.some(e => e.includes('already owned'))).toBe(true);
  });

  test('rejects unknown step references in control flow body', () => {
    const dsl: WorkflowDSLV2 = {
      version: 'v2',
      name: 'bad-ref',
      steps: [
        {
          id: 'loop',
          type: 'for-each',
          input: {
            collection: 'input.items',
            itemVar: 'item',
            body: ['nonexistent'],
          },
        },
      ],
    };

    const result = generateWorkflowFromDsl(dsl);
    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors.some(e => e.includes('nonexistent'))).toBe(true);
  });

  test('compiled v2 code passes TypeScript transpilation', () => {
    const dsl: WorkflowDSLV2 = {
      version: 'v2',
      name: 'transpile-test',
      steps: [
        { id: 'a', type: 'agent', input: { prompt: 'Step A', role: 'worker' } },
        {
          id: 'branch',
          type: 'if-else',
          dependsOn: ['a'],
          input: {
            condition: { op: 'eq', left: 'steps.a.output.status', right: 'ok' },
            then: ['b'],
          },
        },
        { id: 'b', type: 'agent', input: { prompt: 'Step B', role: 'worker' } },
        {
          id: 'loop',
          type: 'for-each',
          dependsOn: ['branch'],
          input: { collection: 'steps.a.output.items', itemVar: 'item', body: ['c'] },
        },
        { id: 'c', type: 'agent', input: { prompt: 'Process item', role: 'worker' } },
      ],
    };

    const result = generateWorkflowFromDsl(dsl);
    expect(result.validation.valid).toBe(true);
    expect(result.validation.errors).toEqual([]);
    expect(result.code.length).toBeGreaterThan(100);
  });

  test('manifest includes all step IDs including body steps', () => {
    const dsl: WorkflowDSLV2 = {
      version: 'v2',
      name: 'manifest-test',
      steps: [
        { id: 'start', type: 'agent', input: { prompt: 'Begin', role: 'worker' } },
        {
          id: 'check',
          type: 'if-else',
          dependsOn: ['start'],
          input: { condition: { op: 'exists', ref: 'steps.start.output.data' }, then: ['process'] },
        },
        { id: 'process', type: 'agent', input: { prompt: 'Process', role: 'worker' } },
      ],
    };

    const result = generateWorkflowFromDsl(dsl);
    expect(result.manifest.stepIds).toEqual(['start', 'check', 'process']);
    expect(result.manifest.stepTypes).toEqual(['agent', 'if-else', 'agent']);
  });

  test('compiled module binds dedicated runtime handlers for non-agent steps', () => {
    const dsl: WorkflowDSLV2 = {
      version: 'v2',
      name: 'runtime-bindings',
      steps: [
        { id: 'notify', type: 'notification', input: { message: 'done' } },
        { id: 'pause', type: 'wait', dependsOn: ['notify'], input: { durationMs: 1000 } },
        { id: 'convert', type: 'capability', dependsOn: ['pause'], input: { capabilityId: 'md-converter', input: { text: 'hi' } } },
      ],
    };

    const result = generateWorkflowFromDsl(dsl);
    expect(result.validation.valid).toBe(true);
    expect(result.code).toContain('const { agentStep, notificationStep, capabilityStep, waitStep, onStepStarted, onStepCompleted, onStepSkipped } = runtime;');
    expect(result.code).toContain('notificationStep(');
    expect(result.code).toContain('waitStep(');
    expect(result.code).toContain('capabilityStep(');
  });
});
