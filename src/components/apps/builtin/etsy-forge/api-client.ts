// Etsy 选品采集 — 前端 API client。纯爬取，无任何图片生成调用。
// 类型定义见 ./api-types(为满足单文件≤300行拆出),此处 re-export 保持现有 import 路径不变。
export * from './api-types';
import type {
  TaskSchedule,
  KeywordTask,
  Product,
  ImageType,
  LibProduct,
  AssetItem,
  PromptItem,
  MockupItem,
  MockupJob,
  ManualProduct,
  Shop,
  RemixDirection,
  RemixStrategy,
  FissionDiagnosis,
  Cutout,
  LogItem,
  SopStepDef,
  SopRun,
  SopStep,
  AiProviderOption,
  Review,
  ReviewAnalysis,
  RunItem,
  RunListResult,
  RunDetailResult,
  PreviewResult
} from './api-types';

const BASE = '/api/apps/builtin/etsy-forge';

async function jf<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const etsyForgeApi = {
  // 试爬验证
  collectPreview: (keyword: string, maxProducts?: number) =>
    jf<PreviewResult>(`${BASE}/collect-preview`, {
      method: 'POST',
      body: JSON.stringify({ keyword, maxProducts }),
    }),

  // 采集任务
  listTasks: () => jf<{ tasks: KeywordTask[] }>(`${BASE}/tasks`),
  createTask: (
    keyword: string,
    opts: {
      schedule?: TaskSchedule;
      maxProducts?: number;
      minSales?: number;
      minFavorites?: number;
      minPrice?: number;
      maxPrice?: number;
      maxPages?: number;
    } = {},
  ) =>
    jf<{ task: KeywordTask }>(`${BASE}/tasks`, {
      method: 'POST',
      body: JSON.stringify({
        keyword,
        schedule: opts.schedule,
        max_products: opts.maxProducts,
        min_sales: opts.minSales,
        min_favorites: opts.minFavorites,
        min_price: opts.minPrice,
        max_price: opts.maxPrice,
        max_pages: opts.maxPages,
      }),
    }),
  updateTask: (
    id: string,
    patch: {
      enabled?: boolean;
      schedule?: TaskSchedule;
      max_products?: number;
      min_sales?: number;
      min_favorites?: number;
      min_price?: number;
      max_price?: number;
      max_pages?: number;
    },
  ) =>
    jf<{ task: KeywordTask }>(`${BASE}/tasks/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  deleteTask: (id: string) =>
    jf<{ ok: boolean }>(`${BASE}/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  runTaskNow: (id: string, maxProducts?: number) =>
    jf<RunListResult>(`${BASE}/tasks/${encodeURIComponent(id)}/run-now`, {
      method: 'POST',
      body: JSON.stringify({ max_products: maxProducts }),
    }),
  // 停止正在跑的采集:翻完手头这页收手,已爬到的保留入库,终态记 cancelled。
  stopTask: (id: string) =>
    jf<{ ok: boolean; stopping: boolean; recovered?: boolean }>(`${BASE}/tasks/${encodeURIComponent(id)}/stop`, { method: 'POST' }),

  // 商品列表
  listProducts: (opts: { keyword?: string; onlySelected?: boolean } = {}) => {
    const p = new URLSearchParams();
    if (opts.keyword) p.set('keyword', opts.keyword);
    if (opts.onlySelected) p.set('selected', '1');
    return jf<{ total: number; products: Product[] }>(`${BASE}/products?${p.toString()}`);
  },
  setSelected: (ids: string[], selected: boolean) =>
    jf<{ ok: boolean; updated: number }>(`${BASE}/products`, {
      method: 'PATCH',
      body: JSON.stringify({ ids, selected }),
    }),
  collectDetails: (productIds?: string[]) =>
    jf<RunDetailResult>(`${BASE}/products/collect-details`, {
      method: 'POST',
      body: JSON.stringify({ product_ids: productIds ?? [] }),
    }),

  // 图库（按商品维度聚合）
  listLibrary: (opts: { keyword?: string; productId?: string } = {}) => {
    const p = new URLSearchParams();
    if (opts.keyword) p.set('keyword', opts.keyword);
    if (opts.productId) p.set('product_id', opts.productId);
    return jf<{ total: number; productCount: number; products: LibProduct[]; allTags: string[] }>(
      `${BASE}/library?${p.toString()}`,
    );
  },
  // 给图库商品批量加/去标签
  applyProductTags: (productIds: string[], opts: { add?: string[]; remove?: string[] }) =>
    jf<{ ok: boolean; updated: number }>(`${BASE}/library/tags`, {
      method: 'POST',
      body: JSON.stringify({ product_ids: productIds, add: opts.add, remove: opts.remove }),
    }),
  // ②b 详情图分类：对一个商品的详情图 AI 分类(model_scene/product/size/color/other)
  classifyImages: (productId: string) =>
    jf<{ ok: boolean; classified: number; failed: number }>(`${BASE}/images/classify`, {
      method: 'POST',
      body: JSON.stringify({ product_id: productId }),
    }),
  // 人工纠正单张图类型
  setImageType: (imageId: string, imageType: ImageType) =>
    jf<{ ok: boolean }>(`${BASE}/images/classify`, {
      method: 'PATCH',
      body: JSON.stringify({ image_id: imageId, image_type: imageType }),
    }),
  // 批量删除：商品（连带其图）/ 单张图
  deleteLibrary: (opts: { productIds?: string[]; imageIds?: string[] }) =>
    jf<{ ok: boolean; deletedProducts: number; deletedImages: number }>(`${BASE}/library/delete`, {
      method: 'POST',
      body: JSON.stringify({ product_ids: opts.productIds, image_ids: opts.imageIds }),
    }),
  // 评论：列出某商品评论 + 缓存分析
  listReviews: (productId: string) =>
    jf<{
      productId: string;
      title: string;
      reviews: Review[];
      analysis: ReviewAnalysis | null;
      analyzedAt: string | null;
    }>(`${BASE}/library/reviews?product_id=${encodeURIComponent(productId)}`),
  // 跑 AI 评论分析（结果缓存到商品）
  analyzeReviews: (productId: string) =>
    jf<{ ok: boolean; analysis: ReviewAnalysis }>(`${BASE}/library/reviews/analyze`, {
      method: 'POST',
      body: JSON.stringify({ product_id: productId }),
    }),
  // 重新抓取某商品评论（走后台浏览器重开商品页抓，只更新评论不动详情图）
  recollectReviews: (productId: string) =>
    jf<{ ok: boolean; count: number }>(`${BASE}/library/reviews/recollect`, {
      method: 'POST',
      body: JSON.stringify({ product_id: productId }),
    }),
  // 抠图：对选中商品的图去背景。image_ids 指定时只抠选中的，否则抠商品所有图。
  startCutout: (opts: { productIds: string[]; imageIds?: string[]; prompt?: string }) =>
    jf<{ ok: boolean; okProducts: number; failProducts: number }>(`${BASE}/library/cutout`, {
      method: 'POST',
      body: JSON.stringify({ product_ids: opts.productIds, image_ids: opts.imageIds, prompt: opts.prompt }),
    }),
  // 列某商品抠图结果
  listCutouts: (productId: string) =>
    jf<{ productId: string; title: string; cutouts: Cutout[] }>(
      `${BASE}/library/cutouts?product_id=${encodeURIComponent(productId)}`,
    ),
  // 提示词库（5 分类：cutout/scene/model/product/pose）。default_content=该类内置默认。
  listPrompts: (category = 'cutout') =>
    jf<{ prompts: PromptItem[]; default_content: string }>(`${BASE}/prompts?category=${encodeURIComponent(category)}`),
  createPrompt: (p: { category?: string; name: string; content: string; is_default?: boolean }) =>
    jf<{ ok: boolean; id: string }>(`${BASE}/prompts`, { method: 'POST', body: JSON.stringify(p) }),
  // 改内容 / 设为生效（is_default=true 会取消同类其它生效项）
  updatePrompt: (p: { id: string; content?: string; is_default?: boolean }) =>
    jf<{ ok: boolean }>(`${BASE}/prompts`, { method: 'PATCH', body: JSON.stringify(p) }),
  deletePrompt: (id: string) =>
    jf<{ ok: boolean }>(`${BASE}/prompts?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  // 素材库：批量分析（异步，立即返回 started 数；后台跑，前端轮询 asset_status 看进度）
  analyzeAssets: (productIds: string[], imageIds?: string[]) =>
    jf<{ ok: boolean; started: number }>(`${BASE}/assets/analyze`, {
      method: 'POST',
      body: JSON.stringify({ product_ids: productIds, image_ids: imageIds }),
    }),
  // 抠模特姿势（异步）：选含模特的图，逐张抠出真实模特→存「模特姿势」类，前端轮询 pose_status。
  extractPose: (productIds: string[], imageIds?: string[]) =>
    jf<{ ok: boolean; started: number }>(`${BASE}/assets/extract-pose`, {
      method: 'POST',
      body: JSON.stringify({ product_ids: productIds, image_ids: imageIds }),
    }),
  listAssets: (category?: string) =>
    jf<{ assets: AssetItem[] }>(`${BASE}/assets${category ? `?category=${encodeURIComponent(category)}` : ''}`),
  deleteAsset: (id: string) =>
    jf<{ ok: boolean }>(`${BASE}/assets?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  // 单张失败素材重试：用原来源图 + 该类生效 prompt 重新生成
  retryAsset: (id: string) =>
    jf<{ ok: boolean }>(`${BASE}/assets/retry`, { method: 'POST', body: JSON.stringify({ asset_id: id }) }),

  // 二创方向矩阵策略(动态 CRUD,设置可增删改;二创菜单/一键出品读它)
  listStrategies: () => jf<{ strategies: RemixStrategy[] }>(`${BASE}/remix-strategies`),
  createStrategy: (s: Partial<RemixStrategy>) =>
    jf<{ ok: boolean; strategy: RemixStrategy }>(`${BASE}/remix-strategies`, { method: 'POST', body: JSON.stringify(s) }),
  updateStrategy: (id: string, patch: Partial<RemixStrategy>) =>
    jf<{ ok: boolean }>(`${BASE}/remix-strategies`, { method: 'PUT', body: JSON.stringify({ id, ...patch }) }),
  deleteStrategy: (id: string) =>
    jf<{ ok: boolean }>(`${BASE}/remix-strategies?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // ⑤ 二创：按选中的方向矩阵策略(可多选;留空=默认)× 钩子轮转生成变体印花(异步,轮询 listAssets('remix'))。
  remixProduct: (productId: string, directions?: string[]) =>
    jf<{ ok: boolean; started: boolean }>(`${BASE}/remix`, {
      method: 'POST',
      body: JSON.stringify({ product_id: productId, directions }),
    }),
  // Step11 系列化：对一张达标的二创印花(母版)扩展 5-10 张同系列新印花(异步,轮询 listAssets('remix'))。
  remixSeries: (productId: string, baseAssetId: string, count?: number) =>
    jf<{ ok: boolean; started: boolean }>(`${BASE}/remix/series`, {
      method: 'POST',
      body: JSON.stringify({ product_id: productId, base_asset_id: baseAssetId, count }),
    }),

  // 产品合成：印花 × 产品图 → inpaint → 带印花平铺 T(异步，前端轮询 listMockups)。
  generateMockups: (design: { path?: string; url?: string; label?: string; source_product_id?: string }, productAssetIds: string[]) =>
    jf<{ ok: boolean; started: number }>(`${BASE}/mockups`, {
      method: 'POST',
      body: JSON.stringify({ design, product_asset_ids: productAssetIds }),
    }),
  // 内联生成(MidJourney 式):选参考图(任意,可跨产品/图库) + 提示词 → 新图,挂到目标产品下(异步,轮询 listMockups)
  composeProduct: (productId: string, references: string[], prompt: string) =>
    jf<{ ok: boolean; started: boolean }>(`${BASE}/mockups/compose`, {
      method: 'POST',
      body: JSON.stringify({ product_id: productId, references, prompt }),
    }),
  // 按方向出图:选 1 个方向 + 选 1 张底图(baseRef 不传=默认原始印花)→ 按方向改图 + 出 T 产品图,挂到该商品下(异步,轮询 listMockups)
  composeByDirection: (productId: string, direction: string, baseRef?: string) =>
    jf<{ ok: boolean; started: boolean }>(`${BASE}/mockups/by-direction`, {
      method: 'POST',
      body: JSON.stringify({ product_id: productId, direction, base_ref: baseRef }),
    }),
  // 手攒产品(无 Etsy 来源):列 / 新建(增加产品) / 删除(连带名下生成图)
  listManualProducts: () => jf<{ products: ManualProduct[] }>(`${BASE}/manual-products`),
  createManualProduct: (name?: string) =>
    jf<{ ok: boolean; product: ManualProduct }>(`${BASE}/manual-products`, { method: 'POST', body: JSON.stringify({ name }) }),
  deleteManualProduct: (id: string) =>
    jf<{ ok: boolean }>(`${BASE}/manual-products?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // 关注的店铺(一键出品采集):列 / 删除
  listShops: () => jf<{ total: number; shops: Shop[] }>(`${BASE}/shops`),
  deleteShop: (id: string) =>
    jf<{ ok: boolean }>(`${BASE}/shops?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  // 裂变·方向库(动态 CRUD)
  listDirections: () => jf<{ directions: RemixDirection[] }>(`${BASE}/remix-directions`),
  createDirection: (d: Partial<RemixDirection>) =>
    jf<{ ok: boolean; direction: RemixDirection }>(`${BASE}/remix-directions`, { method: 'POST', body: JSON.stringify(d) }),
  updateDirection: (id: string, patch: Partial<RemixDirection>) =>
    jf<{ ok: boolean }>(`${BASE}/remix-directions`, { method: 'PUT', body: JSON.stringify({ id, ...patch }) }),
  deleteDirection: (id: string) =>
    jf<{ ok: boolean }>(`${BASE}/remix-directions?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  // 裂变·诊断(同图有缓存直接用;force=true 才重诊断)
  fissionDiagnose: (baseRef: string, baseAssetId: string, force = false) =>
    jf<{ diagnosis: FissionDiagnosis }>(`${BASE}/fission/diagnose`, { method: 'POST', body: JSON.stringify({ base_ref: baseRef, base_asset_id: baseAssetId, force }) }),
  // 裂变·出图(按配方×张数,标 fission_run/stage + 写运行状态,前端按 run 轮询 listAssets)
  fissionGenerate: (input: { productId: string; baseRef: string; baseAssetId: string; recipes: string[][]; variantsPerRecipe: number; stage: 'preview' | 'finalize' | 'iterate'; fissionRun: string }) =>
    jf<{ ok: boolean; started: number }>(`${BASE}/fission/generate`, {
      method: 'POST',
      body: JSON.stringify({
        product_id: input.productId,
        base_ref: input.baseRef,
        base_asset_id: input.baseAssetId,
        recipes: input.recipes,
        variants_per_recipe: input.variantsPerRecipe,
        stage: input.stage,
        fission_run: input.fissionRun,
      }),
    }),
  // 裂变·活跃运行(供原图显示「裂变中」+ 右下角任务 dock)
  listFissionRuns: () =>
    jf<{ runs: { run_id: string; base_asset_id: string; product_id: string; title: string; stage: string; stage_cn: string; expected: number; started_at: string }[] }>(`${BASE}/fission/runs`),
  listMockups: () => jf<{ mockups: MockupItem[] }>(`${BASE}/mockups`),
  // 给一张产品图打分(1-10;0=清除)
  scoreMockup: (id: string, score: number) =>
    jf<{ ok: boolean; score: number }>(`${BASE}/mockups`, { method: 'PATCH', body: JSON.stringify({ id, score }) }),
  // 单发出图运行记录(微调 / 按方向出图),供右下角「任务」浮层统一展示
  listMockupJobs: () => jf<{ jobs: MockupJob[] }>(`${BASE}/mockups/jobs`),
  deleteMockup: (id: string) =>
    jf<{ ok: boolean }>(`${BASE}/mockups?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  // 重试合成:用当前图片服务商对这张 mockup 重新合成、覆盖原图(异步,前端轮询 listMockups 看换图)
  retryMockup: (mockupId: string) =>
    jf<{ ok: boolean; started: boolean }>(`${BASE}/mockups/retry`, { method: 'POST', body: JSON.stringify({ mockup_id: mockupId }) }),

  // SOP「一键出品」：启动(后台逐商品跑链) / 列运行 / 拿某 run 分步状态 / 单步重试
  startSop: (productIds: string[], directions?: string[]) =>
    jf<{ ok: boolean; runId: string }>(`${BASE}/sop`, { method: 'POST', body: JSON.stringify({ product_ids: productIds, directions }) }),
  listSopRuns: () => jf<{ runs: SopRun[]; stepDefs: SopStepDef[] }>(`${BASE}/sop`),
  getSopRun: (runId: string) =>
    jf<{ run: SopRun; steps: SopStep[]; stepDefs: SopStepDef[] }>(`${BASE}/sop?run_id=${encodeURIComponent(runId)}`),
  retrySopStep: (runId: string, productId: string, stepKey: string) =>
    jf<{ ok: boolean }>(`${BASE}/sop/retry`, {
      method: 'POST',
      body: JSON.stringify({ run_id: runId, product_id: productId, step_key: stepKey }),
    }),

  // 运行日志（排查图片生成成败）
  listLogs: () => jf<{ logs: LogItem[] }>(`${BASE}/logs`),
  clearLogs: () => jf<{ ok: boolean; deleted: number }>(`${BASE}/logs`, { method: 'DELETE' }),

  // 运行结果 / 设置 / 危险
  listRuns: (kind?: string) => jf<{ runs: RunItem[] }>(`${BASE}/runs${kind ? `?kind=${kind}` : ''}`),
  getSettings: () =>
    jf<{
      browser_context_id: string;
      default_max_products?: number;
      download_detail_images?: boolean;
      ai_provider_id?: string;
      ai_model?: string;
      vision_provider_id?: string;
      vision_model?: string;
      ai_providers?: AiProviderOption[];
      ai_locked?: boolean;
      image_concurrency?: number;
      max_pose?: number;
    }>(`${BASE}/settings`),
  updateSettings: (patch: {
    browser_context_id?: string;
    ai_provider_id?: string;
    ai_model?: string;
    vision_provider_id?: string;
    vision_model?: string;
    image_concurrency?: number;
    max_pose?: number;
  }) =>
    jf<{ ok: boolean }>(`${BASE}/settings`, { method: 'PUT', body: JSON.stringify(patch) }),
  danger: (action: 'clear-library' | 'clear-products') =>
    jf<{ ok: boolean; affected?: number }>(`${BASE}/danger`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
};
