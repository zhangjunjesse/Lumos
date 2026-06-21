// 产品开发核心逻辑验收：
//  - 完整度门禁(completeness)：空产品缺必填、不可 ready；填齐必填 → 100% 可 ready
//  - 变体组合(variations)：尺码×颜色笛卡尔积；重建保留已填价/库存/SKU
//  - 从出图组导入(store)：按 score 高→低塞图位、首张设主图、src 走 media serve、封顶 10 张
// 不调任何服务商（AI 文案是集成范畴，这里只测确定性逻辑）。

import Database from 'better-sqlite3';
import { migrateAppTables } from '../../db/migrations-app';
import { createAppDataStore, type AppDataStore } from '../../app/runtime/data-store';
import { COLLECTIONS } from '../types';
import { computeCompleteness } from '../listing/completeness';
import { emptyListingDefaults, type ListingRow } from '../listing/types';
import { comboKeys, rebuildCombos } from '../../../components/apps/builtin/etsy-forge/tabs/develop/variations';
import { createListingFromMockup } from '../listing/store';
import { resolveBatchGen, resolveRefine } from '../listing/photo-gen';

const U = 'local';

function setup(): AppDataStore {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  db.prepare(
    `INSERT INTO lumos_app_apps (id, name, version, manifest_json, source, install_path, installed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('etsy-forge', 'etsy-forge', '1.0.0', '{}', 'builtin', '/tmp/etsy-forge', Date.now());
  return createAppDataStore(db, 'etsy-forge');
}

function makeListing(over: Partial<ListingRow>): ListingRow {
  return { id: 'l1', user_id: U, created_at: '', updated_at: '', ...emptyListingDefaults(), ...over } as ListingRow;
}

describe('完整度门禁', () => {
  it('空白产品：必填缺很多，不可标记待上架', () => {
    const c = computeCompleteness(makeListing({}));
    expect(c.canMarkReady).toBe(false);
    expect(c.percent).toBeLessThan(100);
    expect(c.missing.map((m) => m.key)).toEqual(
      expect.arrayContaining(['title', 'description', 'tags', 'main_photo', 'price', 'taxonomy', 'who_made']),
    );
  });

  it('必填填齐：100% 且可标记待上架', () => {
    const c = computeCompleteness(
      makeListing({
        title: 'Funny Cat Tee',
        description: 'soft cotton tee',
        tags: ['cat tee'],
        photos: [{ role: 'main', position: 0, src: '/x.png', sourceType: 'mockup', isMain: true }],
        price: 19.9,
        quantity: 10,
        taxonomy_path: ['Clothing', 'T-shirts'],
        listing_details: { whoMade: 'i_did', whatIs: 'finished_product', whenMade: 'made_to_order' },
        listing_type: 'physical',
      }),
    );
    expect(c.missing).toHaveLength(0);
    expect(c.percent).toBe(100);
    expect(c.canMarkReady).toBe(true);
  });
});

describe('变体组合', () => {
  it('尺码×颜色笛卡尔积', () => {
    const keys = comboKeys([
      { name: 'Size', options: ['S', 'M'] },
      { name: 'Color', options: ['Black', 'White'] },
    ]);
    expect(keys).toEqual(['S|Black', 'S|White', 'M|Black', 'M|White']);
  });

  it('重建组合时保留已填的价/库存/SKU，丢弃失效组合', () => {
    const rebuilt = rebuildCombos({
      properties: [{ name: 'Size', options: ['S', 'M'] }],
      combos: [
        { key: 'S', price: 20, sku: 'A' },
        { key: 'XL', price: 99 }, // 选项里没 XL → 应被丢弃
      ],
    });
    expect(rebuilt).toEqual([{ key: 'S', price: 20, sku: 'A' }, { key: 'M' }]);
  });

  it('无选项 → 无组合', () => {
    expect(comboKeys([{ name: 'Size', options: [] }])).toEqual([]);
  });
});

describe('从一张产品图新建', () => {
  it('预填选中图为主图 + 它的印花为细节图，名字取产品标题', () => {
    const store = setup();
    const m = store.create(COLLECTIONS.MOCKUPS, {
      user_id: U, source_product_id: 'p1', source_product_title: 'Sun Tee',
      status: 'success', image_path: '/m1.png', design_ref: '/design1.png', score: 5,
      created_at: new Date().toISOString(),
    });
    const listing = createListingFromMockup(store, U, m.id, '');
    expect(listing.source_kind).toBe('from_group');
    expect(listing.source_product_id).toBe('p1');
    expect(listing.internal_name).toBe('Sun Tee');
    expect(listing.photos).toHaveLength(2);
    const main = listing.photos.find((p) => p.role === 'main');
    expect(main?.isMain).toBe(true);
    expect(main?.src).toBe(`/api/media/serve?path=${encodeURIComponent('/m1.png')}`);
    expect(main?.sourceId).toBe(m.id);
    const detail = listing.photos.find((p) => p.role === 'detail');
    expect(detail?.src).toBe(`/api/media/serve?path=${encodeURIComponent('/design1.png')}`);
  });

  it('没印花时只预填主图', () => {
    const store = setup();
    const m = store.create(COLLECTIONS.MOCKUPS, {
      user_id: U, source_product_id: 'p2', status: 'success', image_path: '/m2.png', created_at: new Date().toISOString(),
    });
    const listing = createListingFromMockup(store, U, m.id);
    expect(listing.photos).toHaveLength(1);
    expect(listing.photos[0].role).toBe('main');
  });

  it('选中的图不存在 → 报错', () => {
    const store = setup();
    expect(() => createListingFromMockup(store, U, 'nope')).toThrow();
  });
});

describe('批量出图解析（SOP：印花=唯一参考、颜色主轴、不克隆）', () => {
  const dirs = (m: string[] = [], s: string[] = [], p: string[] = []) => ({ modelDescs: m, sceneDescs: s, poseDescs: p });

  it('全输出 = 模特(modelCount=4) + 场景2 + 特写1 + 平铺1 = 8 张；每张只用印花当参考', () => {
    const l = makeListing({ design_src: '/print.png' });
    const specs = resolveBatchGen(l, { colors: ['Pepper', 'White'], modelCount: 4, outputs: { model: true, scene: true, detail: true, flat: true } }, dirs());
    expect(specs).toHaveLength(8);
    expect(specs.every((s) => s.ref === '/print.png')).toBe(true); // 印花=唯一真图参考(铁律1)
    expect(specs.every((s) => s.label === '商品图')).toBe(true);
    const modelSpecs = specs.filter((s) => s.role === 'model');
    expect(modelSpecs).toHaveLength(4);
    expect(specs.every((s) => !/line-art/i.test(s.prompt))).toBe(true); // #27 根因:所有模板不再把印花当线稿
    expect(modelSpecs[0].prompt).toMatch(/faithfully|original colors/i); // 忠实复刻印花原色原样
    expect(modelSpecs[0].prompt).toContain('PRINTED INTO the fabric'); // 褶皱变形 realism(铁律3)
  });

  it('模特上身张数独立于颜色:1 色 + modelCount 4 → 4 张,各换人/姿势/场景(铁律4 不克隆)', () => {
    const l = makeListing({ design_src: '/print.png' });
    const specs = resolveBatchGen(l, { colors: ['Pepper'], modelCount: 4, outputs: { model: true } }, dirs());
    expect(specs).toHaveLength(4);
    expect(new Set(specs.map((s) => s.prompt)).size).toBe(4); // 4 张各不相同
  });

  it('默认模特上身 4 张(SOP §2 3-4)', () => {
    const l = makeListing({ design_src: '/print.png' });
    const specs = resolveBatchGen(l, { colors: ['Pepper'], outputs: { model: true } }, dirs());
    expect(specs).toHaveLength(4);
  });

  it('印花保真:深/浅色衣服都忠实复刻印花原色,不转线稿、不反色(#27)', () => {
    const l = makeListing({ design_src: '/print.png' });
    const dark = resolveBatchGen(l, { colors: ['Pepper'], modelCount: 1, outputs: { model: true } }, dirs())[0];
    const light = resolveBatchGen(l, { colors: ['White'], modelCount: 1, outputs: { model: true } }, dirs())[0];
    expect(dark.prompt).not.toMatch(/inverted to white/i); // 不再按衣色反色
    expect(dark.prompt).toMatch(/faithfully|original colors/i);
    expect(light.prompt).toMatch(/faithfully|original colors/i);
  });

  it('用户给的方向描述进 prompt（只文字，不喂像素）', () => {
    const l = makeListing({ design_src: '/print.png' });
    const specs = resolveBatchGen(l, { colors: ['Pepper'], modelCount: 1, outputs: { model: true } }, dirs(['young woman, red curly hair, edgy vibe']));
    expect(specs[0].prompt).toContain('young woman, red curly hair, edgy vibe');
  });

  it('选了采集/关注商品图(productDescs)：模特图照那张整体氛围出', () => {
    const l = makeListing({ design_src: '/print.png' });
    const specs = resolveBatchGen(l, { colors: ['Pepper'], modelCount: 1, outputs: { model: true } }, { modelDescs: [], sceneDescs: [], poseDescs: [], productDescs: ['young woman on a sunny beach, candid bright light'] });
    expect(specs[0].prompt).toContain('young woman on a sunny beach, candid bright light');
  });

  it('选了商品图：整体氛围优先(照商品出，"照这张出"是最强信号)', () => {
    const l = makeListing({ design_src: '/print.png' });
    const specs = resolveBatchGen(
      l,
      { colors: ['Pepper'], modelCount: 1, outputs: { model: true } },
      { modelDescs: [], sceneDescs: ['sunny beach with waves'], poseDescs: [], productDescs: ['outdoor sunny forest, young woman curly hair, vibrant'] },
    );
    expect(specs[0].prompt).toContain('outdoor sunny forest, young woman curly hair, vibrant');
    expect(specs[0].prompt).not.toContain('sunny beach with waves');
  });

  it('额外要求注入每张 prompt', () => {
    const l = makeListing({ design_src: '/print.png' });
    const specs = resolveBatchGen(l, { colors: ['Pepper'], modelCount: 1, extra: '模特戴渔夫帽', outputs: { model: true, scene: true, detail: true, flat: true } }, dirs());
    expect(specs.length).toBeGreaterThan(1);
    expect(specs.every((s) => s.prompt.includes('模特戴渔夫帽'))).toBe(true);
  });

  it('风格可选：默认手机随拍，studio→专业棚拍', () => {
    const l = makeListing({ design_src: '/print.png' });
    const def = resolveBatchGen(l, { colors: ['Pepper'], modelCount: 1, outputs: { model: true } }, dirs())[0];
    expect(def.prompt).toContain('casual iPhone'); // 默认手机随拍
    const studio = resolveBatchGen(l, { colors: ['Pepper'], modelCount: 1, style: 'studio', outputs: { model: true } }, dirs())[0];
    expect(studio.prompt).toContain('professional product photography');
  });

  it('没设印花 → 报错', () => {
    expect(() => resolveBatchGen(makeListing({}), { colors: ['Pepper'] }, dirs())).toThrow(/印花/);
  });

  it('没选颜色 → 报错', () => {
    expect(() => resolveBatchGen(makeListing({ design_src: '/print.png' }), { colors: [] }, dirs())).toThrow(/颜色/);
  });

  it('没选任何输出类型 → 报错', () => {
    expect(() => resolveBatchGen(makeListing({ design_src: '/print.png' }), { colors: ['Pepper'], outputs: { model: false, scene: false, detail: false, flat: false } }, dirs())).toThrow(/输出/);
  });
});

describe('精修解析', () => {
  it('refs=[原图]、prompt 含用户指令、label=精修', () => {
    const s = resolveRefine('/photo.png', '背景换成海滩');
    expect(s.refs).toEqual(['/photo.png']);
    expect(s.prompt).toContain('背景换成海滩');
    expect(s.label).toBe('精修');
  });

  it('缺图 → 报错', () => {
    expect(() => resolveRefine('', 'x')).toThrow();
  });
});
