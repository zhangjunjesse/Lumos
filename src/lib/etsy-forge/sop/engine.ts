// SOP 编排引擎:启动一次 run、逐商品独立按链跑(多商品按图片并发度并行)、每步状态落库、单步重试。
// 步间有依赖(后步用前步产物):某步失败则该商品链中断,其余商品不受影响。不 mock:失败记真实原因。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { getImageConcurrency, mapLimit } from '../concurrency';
import { logEvent } from '../log';
import { execStep } from './steps';
import { SOP_STEPS, SOP_ONE_CLICK, isOptionalStep } from './defs';
import { COLLECTIONS, type ProductRow, type SopRunRow, type SopRunStatus, type SopStepRow } from '../types';
import type { RemixDirectionKey } from '../remix-axes';

// 步骤执行上下文:run 级配置(目前只有二创方向矩阵),随链下传给需要的步骤(remix)。
export interface SopStepCtx {
  directions?: RemixDirectionKey[];
}

// 单步执行器签名:成功返回摘要、失败 throw。默认绑定真实 execStep;测试可注入 stub 验证编排契约。
export type StepExecutor = (store: AppDataStore, userId: string, productId: string, stepKey: SopStepRow['step_key'], ctx?: SopStepCtx) => Promise<string>;

const nowIso = () => new Date().toISOString();

function setStep(store: AppDataStore, stepRowId: string, patch: Partial<SopStepRow>): void {
  store.update(COLLECTIONS.SOP_STEPS, stepRowId, { ...patch, updated_at: nowIso() });
}

// 跑单个步骤:状态落库 + 调执行器。返回是否继续后续链(成功=继续;失败时可选步=继续、必需步=中断)。
async function runOneStep(
  store: AppDataStore,
  userId: string,
  productId: string,
  sr: SopStepRow,
  exec: StepExecutor,
  ctx: SopStepCtx,
  title: string,
): Promise<boolean> {
  setStep(store, sr.id, { status: 'running', failure_reason: '', summary: '' });
  try {
    const summary = await exec(store, userId, productId, sr.step_key, ctx);
    setStep(store, sr.id, { status: 'success', summary });
    logEvent(`SOP/${sr.step_key}`, 'info', summary || '成功', title); // 成功也记
    return true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    setStep(store, sr.id, { status: 'failed', failure_reason: reason });
    logEvent(`SOP/${sr.step_key}`, 'error', reason, title);
    return isOptionalStep(sr.step_key); // 可选步(采店铺)失败:不断链;必需步失败:中断
  }
}

// 跑一个商品从指定 order 起的后续链;必需步失败则中断(后续步依赖前步产物),可选步失败继续。
async function runChainFrom(
  store: AppDataStore,
  userId: string,
  productId: string,
  stepRows: SopStepRow[],
  fromOrder: number,
  exec: StepExecutor,
  ctx: SopStepCtx = {},
): Promise<void> {
  const ordered = [...stepRows].sort((a, b) => a.step_order - b.step_order);
  const title = ordered[0]?.product_title || productId; // 日志注明哪个商品(标题优先,回退 id)
  for (const sr of ordered) {
    if (sr.step_order < fromOrder) continue;
    if (!(await runOneStep(store, userId, productId, sr, exec, ctx, title))) return;
  }
}

// 一个商品的链是否已到终态:必需步失败(链断)= 终态;末步 mockup 成功(跑完)= 终态;否则还在进行中。
// 可选步(采店铺)失败不算链断——它失败时链会继续走到 mockup,故只看必需步的失败。
function productTerminal(steps: SopStepRow[]): { terminal: boolean; done: boolean } {
  if (steps.some((s) => s.status === 'failed' && !isOptionalStep(s.step_key))) return { terminal: true, done: false };
  const mockup = steps.find((s) => s.step_key === 'mockup');
  const done = mockup?.status === 'success';
  return { terminal: done, done };
}

// 汇总 run 状态。关键:只要还有商品的链在跑(没失败、也没到出产品图),就保持「进行中」,绝不提前下终态——
// 否则并发场景下(如对某个失败步重试时其它商品仍在跑)会把整单误标失败。全部到终态后:全成→success / 部分→partial / 全败→failed。
function finalizeRun(store: AppDataStore, runId: string): void {
  const steps = store.query<SopStepRow>(COLLECTIONS.SOP_STEPS, { filter: { run_id: runId }, limit: 5000 });
  const products = [...new Set(steps.map((s) => s.product_id))];
  let allTerminal = true;
  let done = 0;
  for (const pid of products) {
    const t = productTerminal(steps.filter((s) => s.product_id === pid));
    if (!t.terminal) allTerminal = false;
    if (t.done) done++;
  }
  if (!allTerminal) {
    // 还有商品在跑:保持 running(清掉可能残留的 ended_at),让前端继续轮询、不误判。
    store.update(COLLECTIONS.SOP_RUNS, runId, { status: 'running', ended_at: '' });
    return;
  }
  const status: SopRunStatus = done === products.length && done > 0 ? 'success' : done > 0 ? 'partial' : 'failed';
  store.update(COLLECTIONS.SOP_RUNS, runId, { status, ended_at: nowIso() });
}

// 读 run 上存的二创方向 code(任意非空字符串,策略动态);空 → 由 runRemix 用默认策略。
function runCtx(run: SopRunRow | null | undefined): SopStepCtx {
  const dirs = (Array.isArray(run?.directions) ? run!.directions : []).filter((d): d is string => typeof d === 'string' && !!d);
  return { directions: dirs.length ? dirs : undefined };
}

// 同步建 run + 预建每商品每步 step rows(pending),让 route 立刻拿到 runId、UI 立刻展示完整网格。
export function createSopRun(
  store: AppDataStore,
  input: { userId: string; productIds: string[]; directions?: RemixDirectionKey[] },
): { runId: string } {
  const productIds = [...new Set(input.productIds)].filter(Boolean);
  if (!productIds.length) throw new Error('没有选中商品');
  const directions = (input.directions ?? []).filter((d) => typeof d === 'string' && !!d);

  const run = store.create(COLLECTIONS.SOP_RUNS, {
    user_id: input.userId,
    sop_key: SOP_ONE_CLICK,
    product_ids: productIds,
    directions,
    status: 'running',
    total: productIds.length,
    started_at: nowIso(),
  });

  for (const pid of productIds) {
    const p = store.get<ProductRow>(COLLECTIONS.PRODUCTS, pid);
    for (const def of SOP_STEPS) {
      store.create(COLLECTIONS.SOP_STEPS, {
        run_id: run.id,
        user_id: input.userId,
        product_id: pid,
        product_title: p?.title ?? '',
        step_key: def.key,
        step_order: def.order,
        status: 'pending',
        updated_at: nowIso(),
      });
    }
  }
  return { runId: run.id };
}

// 后台执行整个 run:逐商品并发(图片并发度),每商品独立按链跑,结尾汇总终态。
export async function executeSopRun(store: AppDataStore, userId: string, runId: string, exec: StepExecutor = execStep): Promise<void> {
  const ctx = runCtx(store.get<SopRunRow>(COLLECTIONS.SOP_RUNS, runId));
  const steps = store.query<SopStepRow>(COLLECTIONS.SOP_STEPS, { filter: { run_id: runId }, limit: 5000 });
  const byProduct = new Map<string, SopStepRow[]>();
  for (const s of steps) {
    const arr = byProduct.get(s.product_id) ?? [];
    arr.push(s);
    byProduct.set(s.product_id, arr);
  }
  const productIds = [...byProduct.keys()];
  await mapLimit(productIds, getImageConcurrency(store), async (pid) => {
    await runChainFrom(store, userId, pid, byProduct.get(pid)!, 0, exec, ctx);
  });
  finalizeRun(store, runId);
}

// 单步重试:从指定步起重跑该商品后续链(失败可续)。
export async function retryStep(
  store: AppDataStore,
  input: { userId: string; runId: string; productId: string; stepKey: string },
  exec: StepExecutor = execStep,
): Promise<void> {
  const rows = store.query<SopStepRow>(COLLECTIONS.SOP_STEPS, {
    filter: { run_id: input.runId, product_id: input.productId },
    limit: 100,
  });
  if (rows.length === 0) throw new Error('找不到该 SOP 步骤');
  const target = rows.find((r) => r.step_key === input.stepKey);
  if (!target) throw new Error('找不到该步');
  const ctx = runCtx(store.get<SopRunRow>(COLLECTIONS.SOP_RUNS, input.runId));
  store.update(COLLECTIONS.SOP_RUNS, input.runId, { status: 'running', ended_at: '' });
  if (isOptionalStep(target.step_key)) {
    // 可选步(采店铺)独立于主链:只重跑它自己,不级联下游(否则会白白重生成抠图/二创/产品图)。
    const title = rows[0]?.product_title || input.productId;
    await runOneStep(store, input.userId, input.productId, target, exec, ctx, title);
  } else {
    await runChainFrom(store, input.userId, input.productId, rows, target.step_order, exec, ctx);
  }
  finalizeRun(store, input.runId);
}
