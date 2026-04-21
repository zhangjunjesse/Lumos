import { isBlankWorkflowDraft } from '../dsl';

describe('isBlankWorkflowDraft', () => {
  test('returns true for workflows with no nodes', () => {
    expect(isBlankWorkflowDraft({
      version: 'v3',
      name: 'Blank workflow',
      nodes: [],
      edges: [],
    })).toBe(true);
  });

  test('returns false for workflows that still contain nodes', () => {
    expect(isBlankWorkflowDraft({
      version: 'v3',
      name: 'Non blank workflow',
      nodes: [
        { id: 'stepA', type: 'agent', input: { prompt: 'hello' } },
      ],
      edges: [],
    })).toBe(false);
  });
});
