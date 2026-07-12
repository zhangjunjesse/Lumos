// SOP 编排引擎集成测试:隔离内存 DB + stub 单步执行器(不碰真实图片服务商/生产库)。
// 验证编排契约:预建步骤网格、逐商品独立、某步失败中断该商品链且不影响其它商品、失败落库记因、单步重试续跑、终态汇总。

import Database from 'better-sqlite3';

// logEvent 写的是生产库(~/.lumos);测试里 mock 成 no-op,别把「stub 失败」噪声写进真实日志。
jest.mock('../../log', () => ({ logEvent: jest.fn() }));

// engine → steps → team/run-team → claude-agent-sdk(纯 ESM,jest 解析不了);
// 本套件用 stub executor 不碰真实步骤,mock 掉 SDK 入口即可(先例:lumos-butler-mcp-server.test)。
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
  tool: jest.fn(() => ({})),
  createSdkMcpServer: jest.fn(() => ({})),
}));

import { migrateAppTables } from '../../../db/migrations-app';
import { createAppDataStore, type AppDataStore } from '../../../app/runtime/data-store';
import { createSopRun, executeSopRun, retryStep, type StepExecutor } from '../engine';
import { SOP_STEPS } from '../defs';
import { COLLECTIONS, type SopRunRow, type SopStepRow } from '../../types';

function setupStore(): AppDataStore {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  db.prepare(
    `INSERT INTO lumos_app_apps (id, name, version, manifest_json, source, install_path, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('etsy-forge', 'etsy-forge', '1.0.0', '{}', 'builtin', '/tmp/etsy-forge', Date.now());
  return createAppDataStore(db, 'etsy-forge');
}

const USER = 'u1';

function seedProduct(store: AppDataStore, title: string): string {
  return store.create(COLLECTIONS.PRODUCTS, { user_id: USER, title, source: 'etsy', selected: true, created_at: new Date().toISOString() }).id;
}

function findStep(store: AppDataStore, runId: string, productId: string, stepKey: string): SopStepRow | undefined {
  return store
    .query<SopStepRow>(COLLECTIONS.SOP_STEPS, { filter: { run_id: runId, product_id: productId, step_key: stepKey }, limit: 1 })[0];
}

const allOk: StepExecutor = async (_s, _u, _p, key) => `ok:${key}`;
const failAt = (productId: string, stepKey: string): StepExecutor => async (_s, _u, pid, key) => {
  if (pid === productId && key === stepKey) throw new Error(`stub 失败:${key}`);
  return `ok:${key}`;
};

describe('SOP 编排引擎', () => {
  it('createSopRun 预建 run + 每商品每步 pending 网格', () => {
    const store = setupStore();
    const a = seedProduct(store, '商品A');
    const b = seedProduct(store, '商品B');
    const { runId } = createSopRun(store, { userId: USER, productIds: [a, b] });

    const run = store.get<SopRunRow>(COLLECTIONS.SOP_RUNS, runId);
    expect(run?.status).toBe('running');
    expect(run?.total).toBe(2);

    const steps = store.query<SopStepRow>(COLLECTIONS.SOP_STEPS, { filter: { run_id: runId }, limit: 100 });
    expect(steps).toHaveLength(2 * SOP_STEPS.length);
    expect(steps.every((s) => s.status === 'pending')).toBe(true);
    expect(findStep(store, runId, a, 'detail')?.product_title).toBe('商品A');
  });

  it('全步成功 → 所有步 success、run=success', async () => {
    const store = setupStore();
    const a = seedProduct(store, '商品A');
    const { runId } = createSopRun(store, { userId: USER, productIds: [a] });
    await executeSopRun(store, USER, runId, allOk);

    const steps = store.query<SopStepRow>(COLLECTIONS.SOP_STEPS, { filter: { run_id: runId }, limit: 100 });
    expect(steps.every((s) => s.status === 'success')).toBe(true);
    expect(findStep(store, runId, a, 'mockup')?.summary).toBe('ok:mockup');
    expect(store.get<SopRunRow>(COLLECTIONS.SOP_RUNS, runId)?.status).toBe('success');
  });

  it('某商品某步失败 → 该商品链中断、后续保持 pending、不影响其它商品、run=partial', async () => {
    const store = setupStore();
    const a = seedProduct(store, '商品A');
    const b = seedProduct(store, '商品B');
    const { runId } = createSopRun(store, { userId: USER, productIds: [a, b] });

    // 商品B 在 cutout(第3步,order=3)失败
    await executeSopRun(store, USER, runId, failAt(b, 'cutout'));

    // 商品A 不受影响:全 success
    expect(findStep(store, runId, a, 'mockup')?.status).toBe('success');

    // 商品B:cutout 之前 success、cutout failed 且记因、cutout 之后保持 pending(链中断)
    expect(findStep(store, runId, b, 'classify')?.status).toBe('success');
    const bCut = findStep(store, runId, b, 'cutout');
    expect(bCut?.status).toBe('failed');
    expect(bCut?.failure_reason).toContain('stub 失败:cutout');
    expect(findStep(store, runId, b, 'assets')?.status).toBe('pending');
    expect(findStep(store, runId, b, 'remix')?.status).toBe('pending');
    expect(findStep(store, runId, b, 'mockup')?.status).toBe('pending');

    // A 完成、B 没完成 → partial
    expect(store.get<SopRunRow>(COLLECTIONS.SOP_RUNS, runId)?.status).toBe('partial');
  });

  it('单步重试 → 从失败步重跑后续链、补齐成功、run 回到 success', async () => {
    const store = setupStore();
    const b = seedProduct(store, '商品B');
    const { runId } = createSopRun(store, { userId: USER, productIds: [b] });

    await executeSopRun(store, USER, runId, failAt(b, 'cutout'));
    expect(store.get<SopRunRow>(COLLECTIONS.SOP_RUNS, runId)?.status).toBe('failed');
    expect(findStep(store, runId, b, 'cutout')?.status).toBe('failed');

    // 重试 cutout(这次给全成执行器):cutout 及之后全部跑通
    await retryStep(store, { userId: USER, runId, productId: b, stepKey: 'cutout' }, allOk);

    expect(findStep(store, runId, b, 'cutout')?.status).toBe('success');
    expect(findStep(store, runId, b, 'mockup')?.status).toBe('success');
    expect(store.get<SopRunRow>(COLLECTIONS.SOP_RUNS, runId)?.status).toBe('success');
  });

  it('其它商品还在跑时,对失败商品重试不会把整单误标失败(保持进行中)', async () => {
    const store = setupStore();
    const a = seedProduct(store, '商品A'); // 还在跑
    const b = seedProduct(store, '商品B'); // 某步失败
    const { runId } = createSopRun(store, { userId: USER, productIds: [a, b] });

    // 模拟 A 链刚起步(detail 成功、其余 pending)→ A 非终态
    const aDetail = findStep(store, runId, a, 'detail')!;
    store.update(COLLECTIONS.SOP_STEPS, aDetail.id, { status: 'success' });
    // 模拟 B 在 cutout 失败 → B 终态(失败)
    const bCut = findStep(store, runId, b, 'cutout')!;
    store.update(COLLECTIONS.SOP_STEPS, bCut.id, { status: 'failed', failure_reason: 'x' });

    // 对 B 重试但仍失败:B 还是终态失败,A 仍非终态 → 整单必须保持 running,不能下「失败」终态
    await retryStep(store, { userId: USER, runId, productId: b, stepKey: 'cutout' }, failAt(b, 'cutout'));

    expect(store.get<SopRunRow>(COLLECTIONS.SOP_RUNS, runId)?.status).toBe('running');
  });

  it('可选步(采店铺)失败 → 不断链:后续步照常 success、run=success', async () => {
    const store = setupStore();
    const a = seedProduct(store, '商品A');
    const { runId } = createSopRun(store, { userId: USER, productIds: [a] });

    await executeSopRun(store, USER, runId, failAt(a, 'shop')); // shop(order=1)失败

    const shop = findStep(store, runId, a, 'shop');
    expect(shop?.status).toBe('failed');
    expect(shop?.failure_reason).toContain('stub 失败:shop');
    // 后续步没被 shop 失败中断:照常跑完
    expect(findStep(store, runId, a, 'cutout')?.status).toBe('success');
    expect(findStep(store, runId, a, 'mockup')?.status).toBe('success');
    // 可选步失败不算链断 → 整单 success(不是 partial/failed)
    expect(store.get<SopRunRow>(COLLECTIONS.SOP_RUNS, runId)?.status).toBe('success');
  });

  it('重试可选步(采店铺)只重跑它自己,不级联下游(不会重生成出图)', async () => {
    const store = setupStore();
    const a = seedProduct(store, '商品A');
    const { runId } = createSopRun(store, { userId: USER, productIds: [a] });
    await executeSopRun(store, USER, runId, failAt(a, 'shop'));

    // 给 mockup 打哨兵:若重试 shop 级联重跑了下游,这个 summary 会被覆盖。
    const mockup = findStep(store, runId, a, 'mockup')!;
    store.update(COLLECTIONS.SOP_STEPS, mockup.id, { summary: 'SENTINEL' });

    const calls: string[] = [];
    await retryStep(store, { userId: USER, runId, productId: a, stepKey: 'shop' }, async (_s, _u, _p, key) => {
      calls.push(key);
      return `ok:${key}`;
    });

    expect(calls).toEqual(['shop']); // 只调了 shop,没碰下游
    expect(findStep(store, runId, a, 'shop')?.status).toBe('success');
    expect(findStep(store, runId, a, 'mockup')?.summary).toBe('SENTINEL'); // 下游未被重跑
    expect(store.get<SopRunRow>(COLLECTIONS.SOP_RUNS, runId)?.status).toBe('success');
  });

  it('一键出品选的出图团队(teamId)存到 run、执行时透传到 remix 步的 ctx', async () => {
    const store = setupStore();
    const a = seedProduct(store, '商品A');
    const { runId } = createSopRun(store, { userId: USER, productIds: [a], teamId: 'team-42' });
    // 存到了 run 上
    expect(store.get<SopRunRow>(COLLECTIONS.SOP_RUNS, runId)?.team_id).toBe('team-42');

    // 执行时 remix 步应拿到 ctx.teamId,其余步 ctx 不影响
    let remixTeam: string | undefined = undefined;
    const capture: StepExecutor = async (_s, _u, _p, key, ctx) => {
      if (key === 'remix') remixTeam = ctx?.teamId;
      return `ok:${key}`;
    };
    await executeSopRun(store, USER, runId, capture);
    expect(remixTeam).toBe('team-42');
  });

  it('一键出品不选团队 → run.team_id 为空、remix 步 ctx.teamId=undefined(由 runTeamRemix 用默认团队)', async () => {
    const store = setupStore();
    const a = seedProduct(store, '商品A');
    const { runId } = createSopRun(store, { userId: USER, productIds: [a] });
    expect(store.get<SopRunRow>(COLLECTIONS.SOP_RUNS, runId)?.team_id).toBe('');

    let remixCtxSeen = true as boolean;
    let remixTeam: string | undefined = 'sentinel';
    const capture: StepExecutor = async (_s, _u, _p, key, ctx) => {
      if (key === 'remix') {
        remixCtxSeen = ctx !== undefined;
        remixTeam = ctx?.teamId;
      }
      return `ok:${key}`;
    };
    await executeSopRun(store, USER, runId, capture);
    expect(remixCtxSeen).toBe(true);
    expect(remixTeam).toBeUndefined();
  });
});
