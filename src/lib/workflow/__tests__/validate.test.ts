import { validateWorkflowDsl } from '../validate';

describe('validateWorkflowDsl (unified dispatcher)', () => {
  test('returns empty summary for non-object input', () => {
    const r = validateWorkflowDsl(null);
    expect(r.valid).toBe(true);
    expect(r.canRun).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  test('returns empty summary for unknown version', () => {
    const r = validateWorkflowDsl({ version: 'v99', nodes: [], edges: [] });
    expect(r.valid).toBe(true);
    expect(r.errorCount).toBe(0);
  });

  test('returns empty summary for legacy v2 input (no longer supported)', () => {
    const r = validateWorkflowDsl({ version: 'v2', name: 'old', steps: [] });
    expect(r.valid).toBe(true);
    expect(r.errorCount).toBe(0);
  });

  test('v3 — passes clean agent→agent flow', () => {
    const r = validateWorkflowDsl({
      version: 'v3',
      name: 'ok',
      nodes: [
        { id: 'a', type: 'agent', input: { prompt: 'hi' } },
        { id: 'b', type: 'agent', input: { prompt: '{{ steps.a.output.text }}' } },
      ],
      edges: [{ from: 'a', to: 'b', kind: 'next' }],
    });
    expect(r.valid).toBe(true);
    expect(r.canRun).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  test('v3 — surfaces structural error and groups by nodeId', () => {
    const r = validateWorkflowDsl({
      version: 'v3',
      name: 'bad',
      nodes: [
        { id: 'a', type: 'agent', input: { prompt: '{{ steps.ghost.output.x }}' } },
      ],
      edges: [],
    });
    expect(r.valid).toBe(false);
    expect(r.canRun).toBe(false);
    const byA = r.issuesByNodeId.a ?? [];
    expect(byA.some((i) => i.code === 'E_UNKNOWN_REF')).toBe(true);
  });
});
