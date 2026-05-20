// 全 mock 数据。取 docs/etsy-erank-ai-selection-sop.md §4 真实样例(EWC lace 婚礼标牌清单)。
// 配额自洽:月上限 200,期初已用 50(历史轮),余 150;本轮③收敛 112,④回灌扣 112 → 已用 162 余 38。

import type {
  KeywordMetric,
  ManualValidation,
  OpportunityCandidate,
  ProductBrief,
  QuotaEntry,
  RadarRun,
  SeedTerm,
} from './etsy-erank-types';

export const QUOTA_PERIOD = '2026-05';
export const QUOTA_USED_BEFORE = 50; // 历史轮已用
export const CONVERGE_COUNT = 112;

export const ACTIVE_RUN_ID = 'OPP-雷达-2026-05';

export const RUNS: RadarRun[] = [
  {
    id: ACTIVE_RUN_ID,
    label: 'OPP-雷达-2026-05',
    status: 'running',
    executor: 'paste',
    startedAt: '05-19 10:22',
    seedCount: 38,
    convergeCount: CONVERGE_COUNT,
    summary: '婚礼标牌方向,等④配额闸',
  },
  {
    id: 'OPP-雷达-2026-04',
    label: 'OPP-雷达-2026-04',
    status: 'completed',
    executor: 'adspower',
    startedAt: '05-02',
    finishedAt: '05-02',
    seedCount: 41,
    convergeCount: 96,
    summary: '已完成,立项 2',
    gradeTally: { a: 2, b: 3, c: 5, brief: 2 },
  },
  {
    id: 'OPP-雷达-2026-03',
    label: 'OPP-雷达-2026-03',
    status: 'failed',
    executor: 'adspower',
    startedAt: '05-01',
    seedCount: 33,
    convergeCount: 88,
    summary: '④验真失败',
    failureReason: 'eRank 导出列名变更(字段漂移)→ 按列名映射失败,可转粘贴重跑',
  },
];

export const HUNTGROUND = [
  { dir: '婚礼标牌', why: '可做亚克力/木质定制,刻字供应链可控' },
  { dir: '婚礼贴纸', why: 'POD 印花,起订量低,易测款' },
  { dir: '定制木牌', why: '现有激光设备,差异化空间大' },
];

export const SEEDS: SeedTerm[] = [
  { sourceTool: 'Trend Buzz', keyword: 'lace wedding sign', category: '婚礼标牌' },
  { sourceTool: 'Trend Buzz', keyword: 'sheer wedding sign', category: '婚礼标牌' },
  { sourceTool: 'Monthly Trends', keyword: 'fabric wedding sign', category: '婚礼标牌' },
  { sourceTool: 'Monthly Trends', keyword: 'wedding decor', category: '婚礼装饰' },
  { sourceTool: 'Category Report', keyword: 'engagement sign', category: '婚礼标牌' },
  { sourceTool: 'Category Report', keyword: 'wedding backdrop', category: '婚礼背景' },
  { sourceTool: 'Top Sellers', keyword: 'custom wedding sign', category: '婚礼标牌' },
  { sourceTool: 'Top Sellers', keyword: 'romantic wedding', category: '婚礼装饰' },
];

export const CONVERGE_PREVIEW = [
  'lace wedding sign',
  'fabric wedding sign',
  'custom wedding sign',
  'engagement sign',
  'sheer wedding sign',
  'lace ceremony sign welcome',
  'fabric aisle sign rustic',
  'personalized lace sign acrylic',
];

// ④ 回灌后的真实导出(SOP §4 原始数字,source 随执行器)
export const METRICS: KeywordMetric[] = [
  { keyword: 'lace wedding sign', searches: '363', clicks: '221', ctr: '61%', competition: 621, kd: 12, trend: '5月单峰', source: 'paste' },
  { keyword: 'fabric wedding sign', searches: '309', clicks: '312', ctr: '101%', competition: 3199, kd: 51, trend: '多月稳', source: 'paste' },
  { keyword: 'custom wedding sign', searches: '1029', clicks: '1286', ctr: '125%', competition: 134487, kd: 100, trend: '稳', source: 'paste' },
  { keyword: 'engagement sign', searches: '343', clicks: '343', ctr: '100%', competition: 39734, kd: 100, trend: '稳', source: 'paste' },
  { keyword: 'wedding sign', searches: '5206', clicks: '5674', ctr: '109%', competition: 406704, kd: 95, trend: '稳', source: 'paste' },
  { keyword: 'romantic wedding', searches: '<20', clicks: '0', ctr: 'Unknown', competition: 126900, kd: 100, trend: '跌', source: 'paste' },
  { keyword: 'sheer wedding sign', searches: '<20', clicks: '0', ctr: 'Unknown', competition: 62, kd: 66, trend: '平', source: 'paste' },
];

// ⑤ 打分(grade/reason 直接采 SOP §4 判定列结论,数字不改)
export const CANDIDATES: OpportunityCandidate[] = [
  {
    id: 'c-lace', keyword: 'lace wedding sign', productGuess: '蕾丝亚克力婚礼标牌',
    grade: 'A', metric: METRICS[0], reason: '有需求、几乎无竞争、极易排(金矿)',
    seasonality: '5月单峰婚礼季,需提前 4–6 周上,非常青', nextStep: '进人工验证', evidenceSufficient: true,
  },
  {
    id: 'c-fabric', keyword: 'fabric wedding sign', productGuess: '布艺婚礼指示牌',
    grade: 'B', metric: METRICS[1], reason: '需求 + 低竞争 + 中难度,缺口',
    seasonality: '多月稳,常青', nextStep: '进人工验证', evidenceSufficient: true,
  },
  {
    id: 'c-custom', keyword: 'custom wedding sign', productGuess: '定制婚礼标牌(大词)',
    grade: 'C', metric: METRICS[2], reason: '需求/意图强但竞争+难度拉满 → 仅标题副词',
    seasonality: '稳', nextStep: '仅作标题副词蹭量', evidenceSufficient: true,
  },
  {
    id: 'c-eng', keyword: 'engagement sign', productGuess: '订婚标牌',
    grade: 'C', metric: METRICS[3], reason: '竞争尚可但 KD=100,优先级低',
    seasonality: '稳', nextStep: '仅作标题副词', evidenceSufficient: true,
  },
  {
    id: 'c-wed', keyword: 'wedding sign', productGuess: '—',
    grade: 'drop', metric: METRICS[4], reason: '类目大词红海(40万在售)→ 仅标题锚词,不主攻',
    seasonality: '稳', nextStep: '淘汰为主攻,仅锚词', evidenceSufficient: true,
  },
  {
    id: 'c-rom', keyword: 'romantic wedding', productGuess: '—',
    grade: 'drop', metric: METRICS[5], reason: '没需求(月搜<20)+ 红海 → 删',
    seasonality: '跌', nextStep: '淘汰', evidenceSufficient: false,
  },
  {
    id: 'c-sheer', keyword: 'sheer wedding sign', productGuess: '—',
    grade: 'drop', metric: METRICS[6], reason: '低竞争陷阱典型:竞争仅62但没需求没人点 → 删',
    seasonality: '平', nextStep: '淘汰', evidenceSufficient: false,
  },
];

function freshChecks() {
  return [
    { key: 'concentration', label: '竞品集中度', focus: '前排是否被少数大店垄断', result: null },
    { key: 'price', label: '价格带', focus: '竞品售价是否支持你的成本结构', result: null },
    { key: 'image', label: '图片差异化', focus: '主图/场景/包装能否区分', result: null },
    { key: 'review', label: '评论痛点', focus: '买家是否反复抱怨同类问题', result: null },
    { key: 'risk', label: '交付风险', focus: '材质/定制/时效/侵权是否可控', result: null },
    { key: 'profit', label: '利润空间', focus: '扣费后是否仍能 ≥30%', result: null },
  ] as ManualValidation['checks'];
}

export const VALIDATIONS: ManualValidation[] = [
  { candidateId: 'c-lace', checks: freshChecks(), competitorRef: '', priceBand: '', notes: '', verdict: null },
  { candidateId: 'c-fabric', checks: freshChecks(), competitorRef: '', priceBand: '', notes: '', verdict: null },
];

export const BRIEF: ProductBrief = {
  candidateId: 'c-lace', keyword: 'lace wedding sign', target: '美国婚礼新人 / 婚礼策划',
  useCase: '婚礼仪式区欢迎牌、指示牌(5月旺季)',
  valueProp: '蕾丝质感 + 可定制刻字 + 礼盒,差异化于普通亚克力大路货',
  costNote: '待补:亚克力/蕾丝采购、刻字、礼盒、国际物流',
  profitNote: '目标毛利 ≥30%,成本未知,仅初步估算不作定论',
  grade: 'A', action: '小批量打样 + 提前 4–6 周上(季节词)',
};

export const QUOTA_LEDGER: QuotaEntry[] = [
  { period: '2026-05', step: 'OPP-2026-04 ④验真', debited: 50, balanceAfter: 150, at: '05-02 09:10' },
];
