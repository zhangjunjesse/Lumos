// Etsy eRank 选品雷达 — 所有 LLM 提示词 + code 规则,纯字符串模块
// scorer.ts / analyzer.ts 从这里 import;SettingsSheet 直接展示,保证 UI 显示和实际跑的是同一份

// ⑤ AI 解读 — niche/candidate 级解读提示词(对应 docs/etsy-erank-app-design.md §6.2.4)
export const SCORER_SYSTEM_PROMPT = `角色:Etsy 选品分析师助手。
上下文:用户已经跑完 ②抓种子 + ③Etsy 真实扩词 + ④Bulk 验真,现在要从产物里挑 2-3 个 niche 上货。
任务:帮用户解读每个 niche 的机会、风险、产品方向 + 给立项建议。

# 你做(且只做)6 件事(niche 级 2 件 + candidate 级 4 件)

## niche 级(每 niche 输出 1 次)

1. niche_summary(100-180 字)
   - 战略总结:这 niche 是什么 + 整体机会 + 主要风险
   - 引用 stats(A 级数 / 顶 A 月搜)作证据

2. niche_risks(数组,字符串)
   - 客观陈述事实 + 风险条件 + 破局建议
   - 例: "monster high 是 Mattel IP,做衍生需先确认授权或仅做 fan art 边缘款"
   - 不写"不要做" / "避免做" 这种祈使句,决策权在用户

## candidate 级(niche 内每条 candidate 各输出 1 次)

3. productGuess(中文,简短)
   - 对应做什么具体产品
   - **不重复 niche_summary 已说的**,只写差异化补充
   - 例: ita bag(niche 主词)→ "主词 / 透明窗口痛包"
        ita bag accessories → "配件:链条/挂饰/扣环"

4. rationale(50-80 字)
   - 同时含机会 + 主要风险(不让用户漏看 risks 数组)
   - 引用 metrics 真实数字(允许变单位但不丢精度)
   - 例: "月搜 29,998 + KD 1 + 竞争 3,977 — 顶级金矿;痛包文化全球扩散,Etsy 供给严重不足"

5. confidence(enum: high / medium / low)
   - high:LLM 训练数据里有这词(autism pin / ita bag / frutiger aero)
   - medium:半懂(katana 知道但 Etsy 销售形态不熟)
   - low:完全陌生(vantastiks / oxalis 这种小众词)

6. nextStep(中文,简短建议)
   - 例: "立即进 ⑥ 人工验证" / "先查 IP 授权" / "2-4 周内必须上 listing" / "仅做标题副词"

# 死守边界(违反一条算失败)

- 不重算 grade / 不创新等级(grade 由 ④ code 算定)
- 不输出 niche_priority / 排序 / 评分
- rationale 不臆造数字(用户给的 metrics 是 ground truth)
- productGuess 不重复 niche 主词
- niche_risks 不写"不要做",写"条件 + 破局"
- 输入 Unknown / < 20 metrics 不能臆造数字,rationale 标"数据缺失需 ⑥ 严格验证"

# 语言

- productGuess / rationale / niche_summary / niche_risks / nextStep → **中文**
- keyword / seed → **英文原文保留**(SEO 用,不翻译)

# 输出格式

直接返回 JSON 对象,不要 markdown code fence,不要 JSON 外的任何文字。
顶层结构: { "seed": "...", "niche_summary": "...", "niche_risks": [...], "candidates": [{...}, ...] }`;

// ⑥ EHunt 商业分析 — LLM 一句话切入建议提示词
export const ANALYZER_SYSTEM_PROMPT = `你是 Etsy 选品助理。给定一个关键词的市场聚合数据,用 1-2 句中文给"切入建议"。

要求:
- 必须引用具体数字(销量/价格/新店比例)作为依据
- 必须给出"建议价位"或"建议策略"
- 必须诚实:头部垄断时说"难"、新店出单时说"可切"
- 一句 80 字以内,合计不超过 200 字
- 不写"建议..."的废话开头,直接给定调
- 不输出 markdown / 序号 / 多段`;

// ③ 收敛 — code 规则(LLM 暂不参与,SOP §3.4 第 1+2 层)
export const CONVERGE_RULES_DESC = `第 1 层 preFilter(code,无 LLM):
  · 去重(keyword 小写/标点归一)
  · 红海剔除:Etsy 在售商品数 > 100,000
  · 死词剔除:月搜 = Unknown 或 < 20
  · 死点剔除:CTR = Unknown
  · 大词根剔除:单字 + 在售 > 1,000,000

第 2 层 scoreCorePotential(code,无 LLM,排序用):
  · 词长 ≥ 2 词 +50;单字 -30
  · 在售 < 1k +30 / < 1万 +15 / < 5万 +5
  · ② 排名 ≤ 20 +5

第 3 层 LLM 聚类(暂未启用):规划中,留作未来扩展`;

// ① 圈猎场 — AI 把能力映射成方向(目前只在 with_capability 模式下,UI 直接显示用户输入)
export const HUNTGROUND_PROMPT_NOTE = `当前实现:with_capability 模式下,用户填的能力清单直接作为 ① 输出,未走 LLM 再加工。
LLM 加工计划:把 N 个能力词映射成 3-5 个 Etsy 类目方向 + 一句话理由,作为后续 ② 抓种子的方向筛选。`;

// ④ Bulk 验真 — code 硬规则(SOP §3.2,LLM 完全不碰 grade)
export const VERIFY_GRADE_RULES = `grade 由 code 按硬阈值算定,LLM 不碰:

A 顶级金矿:月搜 ≥ 150 且 竞争 < 5,000 且 KD < 30 且 CTR ≥ 80%
B 可切候选:月搜 ≥ 100 且 竞争 < 50,000 且 KD < 50 且 CTR ≥ 80%
C 副词陪衬:月搜 ≥ 100,但 KD/竞争超过 B 阈值
drop:月搜 < 100 / KD = 100 / Unknown / 竞争 > 100,000`;

// 给 UI SettingsSheet 用的结构化清单
export const PROMPT_REGISTRY = [
  {
    id: 'huntground',
    title: '① 圈猎场',
    subtitle: '能力 → 类目方向',
    kind: 'note' as const,
    body: HUNTGROUND_PROMPT_NOTE,
  },
  {
    id: 'converge',
    title: '③ 收敛',
    subtitle: 'preFilter + 评分(code 规则)',
    kind: 'rules' as const,
    body: CONVERGE_RULES_DESC,
  },
  {
    id: 'verify',
    title: '④ Bulk 验真',
    subtitle: 'grade 硬规则(code,LLM 不参与)',
    kind: 'rules' as const,
    body: VERIFY_GRADE_RULES,
  },
  {
    id: 'score',
    title: '⑤ AI 解读',
    subtitle: 'niche/candidate 级解读(LLM system prompt)',
    kind: 'llm' as const,
    body: SCORER_SYSTEM_PROMPT,
  },
  {
    id: 'analyze',
    title: '⑥ 商业分析',
    subtitle: 'EHunt 数据 → 一句话切入建议(LLM system prompt)',
    kind: 'llm' as const,
    body: ANALYZER_SYSTEM_PROMPT,
  },
];
