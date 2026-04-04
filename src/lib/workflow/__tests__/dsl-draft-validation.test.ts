import { isBlankWorkflowDraft } from '../dsl';

describe('isBlankWorkflowDraft', () => {
  test('returns true for workflows with no steps', () => {
    expect(isBlankWorkflowDraft({
      version: 'v2',
      name: 'Blank workflow',
      steps: [],
    })).toBe(true);
  });

  test('returns false for workflows that still contain steps', () => {
    expect(isBlankWorkflowDraft({
      version: 'v2',
      name: 'Non blank workflow',
      steps: [
        { id: 'stepA', type: 'agent', input: { prompt: 'hello' } },
      ],
    })).toBe(false);
  });
});
