/**
 * 类目种子树解析回归锁定。核心契约：选父节点 = 纳入其**全部叶子**（去重），
 * UI 用同一函数算"实际采集数"，预览与 runner 真正跑的必须一致。
 */
import {
  ETSY_CATEGORY_CATALOG,
  findCatalogNode,
  catalogNodePath,
  resolveCatalogTargets,
  buildLeafIndex,
} from '../category-catalog';

describe('category catalog tree', () => {
  it('every node id is unique', () => {
    const ids: string[] = [];
    const walk = (ns: typeof ETSY_CATEGORY_CATALOG): void => {
      for (const n of ns) {
        ids.push(n.id);
        if (n.children) walk(n.children);
      }
    };
    walk(ETSY_CATEGORY_CATALOG);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every leaf has a non-empty search query', () => {
    const leaves: string[] = [];
    const walk = (ns: typeof ETSY_CATEGORY_CATALOG): void => {
      for (const n of ns) {
        if (!n.children?.length) leaves.push(n.query);
        else walk(n.children);
      }
    };
    walk(ETSY_CATEGORY_CATALOG);
    expect(leaves.length).toBeGreaterThan(20);
    expect(leaves.every((q) => q.trim().length > 0)).toBe(true);
  });

  it('findCatalogNode returns node or null', () => {
    expect(findCatalogNode('jewelry')?.name).toBe('Jewelry');
    expect(findCatalogNode('necklaces')?.name).toBe('Necklaces');
    expect(findCatalogNode('___nope___')).toBeNull();
  });

  it('catalogNodePath builds the full breadcrumb', () => {
    expect(catalogNodePath('wall-hangings')).toEqual([
      'Home & Living',
      'Wall Decor',
      'Wall Hangings',
    ]);
    expect(catalogNodePath('necklaces')).toEqual(['Jewelry', 'Necklaces']);
    expect(catalogNodePath('___nope___')).toEqual([]);
  });
});

describe('resolveCatalogTargets', () => {
  it('selecting a top-level parent expands to ALL its leaves (deep)', () => {
    const t = resolveCatalogTargets(['home-living']).map((x) => x.id).sort();
    // wall-decor / kitchen-dining 是父；其叶子 + 两个深度1叶子
    expect(t).toEqual(
      [
        'wall-hangings',
        'tapestries',
        'prints-posters',
        'drinkware',
        'cutting-boards',
        'candles-holders',
        'home-organization',
      ].sort(),
    );
  });

  it('selecting a leaf resolves to just that leaf', () => {
    const t = resolveCatalogTargets(['necklaces']);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({
      id: 'necklaces',
      name: 'Necklaces',
      query: 'personalized necklace',
      path: ['Jewelry', 'Necklaces'],
    });
  });

  it('parent + one of its own children dedupes (child counted once)', () => {
    const t = resolveCatalogTargets(['jewelry', 'rings']);
    const ids = t.map((x) => x.id);
    expect(ids.filter((x) => x === 'rings')).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
    // jewelry 的全部叶子
    expect(ids.sort()).toEqual(
      ['necklaces', 'rings', 'earrings', 'bracelets'].sort(),
    );
  });

  it('two sibling parents = union of all their leaves', () => {
    const t = resolveCatalogTargets(['jewelry', 'clothing']);
    expect(t).toHaveLength(7); // 4 + 3
  });

  it('unknown ids are skipped, not fabricated', () => {
    expect(resolveCatalogTargets(['___nope___', ''])).toEqual([]);
    const t = resolveCatalogTargets(['___nope___', 'rings']);
    expect(t.map((x) => x.id)).toEqual(['rings']);
  });

  it('mid-level parent (Wall Decor) expands to its leaves only', () => {
    const t = resolveCatalogTargets(['wall-decor']).map((x) => x.id).sort();
    expect(t).toEqual(['wall-hangings', 'tapestries', 'prints-posters'].sort());
  });
});

describe('buildLeafIndex (drives leaf-based tree selection + parent tri-state)', () => {
  const idx = buildLeafIndex();

  it('maps a leaf id to just itself', () => {
    expect(idx.get('necklaces')).toEqual(['necklaces']);
  });

  it('maps a mid parent to exactly its leaves', () => {
    expect((idx.get('wall-decor') ?? []).sort()).toEqual(
      ['wall-hangings', 'tapestries', 'prints-posters'].sort(),
    );
  });

  it('maps a top parent to all descendant leaves (deep)', () => {
    expect((idx.get('home-living') ?? []).sort()).toEqual(
      [
        'wall-hangings',
        'tapestries',
        'prints-posters',
        'drinkware',
        'cutting-boards',
        'candles-holders',
        'home-organization',
      ].sort(),
    );
  });

  it('covers every node id and equals resolveCatalogTargets leaf set', () => {
    for (const [id, leaves] of idx) {
      const viaResolve = resolveCatalogTargets([id]).map((t) => t.id).sort();
      expect([...leaves].sort()).toEqual(viaResolve);
    }
    // 含全部叶子与父节点
    expect(idx.has('jewelry')).toBe(true);
    expect(idx.has('rings')).toBe(true);
  });
});
