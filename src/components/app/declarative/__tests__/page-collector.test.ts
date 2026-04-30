import { collectReferencedCollections } from '../page-collector';

describe('collectReferencedCollections', () => {
  it('returns empty for a page with no db bindings', () => {
    expect(
      collectReferencedCollections({
        title: 'X',
        layout: 'form',
        form: [{ type: 'text', name: 'x', label: 'X' }],
        submit: { label: 'Go', run: 'workflow:foo' },
      }),
    ).toEqual([]);
  });

  it('finds the table binding in a list-detail page', () => {
    expect(
      collectReferencedCollections({
        title: 'C',
        layout: 'list-detail',
        list: {
          type: 'table',
          data: '{{ db.customers }}',
          columns: [{ field: 'name', label: 'N' }],
        },
        detail: {
          view: {
            form: [{ type: 'text', name: 'name', label: 'N' }],
            submit: { label: 'Save', run: 'db:update:customers' },
          },
        },
      }),
    ).toEqual(['customers']);
  });

  it('deduplicates and sorts multiple references', () => {
    expect(
      collectReferencedCollections({
        title: 'D',
        layout: 'single',
        blocks: [
          { type: 'markdown', content: 'orders={{ db.orders.count }}, customers={{ db.customers.count }}' },
          { type: 'markdown', content: 'recent customers: {{ db.customers }}' },
        ],
      }),
    ).toEqual(['customers', 'orders']);
  });

  it('ignores non-db bindings', () => {
    expect(
      collectReferencedCollections({
        title: 'X',
        layout: 'single',
        blocks: [{ type: 'markdown', content: '{{ inputs.x }} / {{ config.y }} / {{ user.z }}' }],
      }),
    ).toEqual([]);
  });
});
