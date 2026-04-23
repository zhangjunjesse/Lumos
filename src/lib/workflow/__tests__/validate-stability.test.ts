import { validateWorkflowDsl } from '../validate';

describe('workflow stability validation', () => {
  test('warns when context references steps.x.output.summary directly', () => {
    const report = validateWorkflowDsl({
      version: 'v3',
      name: 'summary-ref',
      nodes: [
        { id: 'crawl', type: 'agent', input: { prompt: 'crawl' } },
        {
          id: 'analyze',
          type: 'agent',
          input: {
            prompt: 'analyze',
            context: {
              crawlResult: 'steps.crawl.output.summary',
            },
          },
        },
      ],
      edges: [{ from: 'crawl', to: 'analyze', kind: 'next' }],
    });

    expect(report.valid).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'W_CONTEXT_SUMMARY_REF')).toBe(true);
  });

  test('fails when workflow guesses runtime shared summary file paths', () => {
    const report = validateWorkflowDsl({
      version: 'v3',
      name: 'shared-path',
      nodes: [
        {
          id: 'cutout',
          type: 'agent',
          input: {
            prompt: 'Read /tmp/run/shared/wf_analyze_output.md and continue.',
          },
        },
      ],
      edges: [],
    });

    expect(report.valid).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'E_SHARED_SUMMARY_FILE_GUESS')).toBe(true);
  });

  test('warns when downstream references machine fields from a non-structured agent output', () => {
    const report = validateWorkflowDsl({
      version: 'v3',
      name: 'non-structured-field',
      nodes: [
        {
          id: 'prepare',
          type: 'agent',
          input: { prompt: 'prepare output path' },
        },
        {
          id: 'next-step',
          type: 'agent',
          input: {
            prompt: 'use it',
            context: {
              reportPath: 'steps.prepare.output.reportPath',
            },
          },
        },
      ],
      edges: [{ from: 'prepare', to: 'next-step', kind: 'next' }],
    });

    expect(report.valid).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'W_NON_STRUCTURED_FIELD_REF')).toBe(true);
  });
});
