import { computeTagRenamePatches } from '../tag-rename';

describe('computeTagRenamePatches', () => {
  it('returns empty when "from" is empty / whitespace', () => {
    expect(computeTagRenamePatches([{ id: 'v1', tags: '["a"]' }], '', 'b')).toEqual([]);
    expect(computeTagRenamePatches([{ id: 'v1', tags: '["a"]' }], '   ', 'b')).toEqual([]);
  });

  it('treats from===to (case-insensitive) as no-op', () => {
    expect(computeTagRenamePatches([{ id: 'v1', tags: '["AI"]' }], 'AI', 'ai')).toEqual([]);
    expect(computeTagRenamePatches([{ id: 'v1', tags: '["AI"]' }], 'ai', 'AI')).toEqual([]);
  });

  it('renames a tag and emits a patch only for changed rows', () => {
    const r = computeTagRenamePatches(
      [
        { id: 'v1', tags: '["AI","prompt"]' },
        { id: 'v2', tags: '["other"]' },
      ],
      'AI',
      'machine-learning',
    );
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('v1');
    expect(JSON.parse(r[0].nextTagsJson)).toEqual(['machine-learning', 'prompt']);
  });

  it('matches case-insensitively (AI / Ai / ai are all renamed)', () => {
    const r = computeTagRenamePatches(
      [
        { id: 'v1', tags: '["AI"]' },
        { id: 'v2', tags: '["Ai"]' },
        { id: 'v3', tags: '["ai"]' },
      ],
      'ai',
      'ml',
    );
    expect(r).toHaveLength(3);
    for (const p of r) {
      expect(JSON.parse(p.nextTagsJson)).toEqual(['ml']);
    }
  });

  it('collapses duplicates when "to" already exists in the row (merge semantic)', () => {
    const r = computeTagRenamePatches(
      [{ id: 'v1', tags: '["AI","ai","ml"]' }],
      'ai',
      'ml',
    );
    // Both AI and ai (which were already deduped to "AI" by parseVideoTags)
    // collapse into the existing "ml". Should leave just ["ml"].
    expect(JSON.parse(r[0].nextTagsJson)).toEqual(['ml']);
  });

  it('preserves order and the casing of unrelated tags', () => {
    const r = computeTagRenamePatches(
      [{ id: 'v1', tags: '["Prompt","AI","Cache"]' }],
      'AI',
      'ml',
    );
    expect(JSON.parse(r[0].nextTagsJson)).toEqual(['Prompt', 'ml', 'Cache']);
  });

  it('empty "to" deletes the tag', () => {
    const r = computeTagRenamePatches(
      [{ id: 'v1', tags: '["AI","prompt","cache"]' }],
      'AI',
      '',
    );
    expect(JSON.parse(r[0].nextTagsJson)).toEqual(['prompt', 'cache']);
  });

  it('skips videos with no tags / null tags', () => {
    const r = computeTagRenamePatches(
      [
        { id: 'v1', tags: null },
        { id: 'v2', tags: '' },
        { id: 'v3', tags: '[]' },
        { id: 'v4', tags: '["AI"]' },
      ],
      'AI',
      'ml',
    );
    expect(r.map((p) => p.id)).toEqual(['v4']);
  });

  it('uses the first occurrence position when renaming (order stability)', () => {
    const r = computeTagRenamePatches(
      [{ id: 'v1', tags: '["a","AI","b","ai"]' }],
      'ai',
      'ml',
    );
    // After parseVideoTags dedup: ["a","AI","b"] (the second "ai" is a dup
    // of "AI"). Rename: ["a","ml","b"].
    expect(JSON.parse(r[0].nextTagsJson)).toEqual(['a', 'ml', 'b']);
  });
});
