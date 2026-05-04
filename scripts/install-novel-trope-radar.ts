/**
 * 一次性脚本:把「网文套路雷达」工作流模板写进 ~/.lumos/lumos.db (workflows 表)
 * 用法:LUMOS_DATA_DIR=~/.lumos npx tsx scripts/install-novel-trope-radar.ts
 *
 * 步骤:
 *   1. 确保有一个 conversation 类型的 agent preset 「网文研究员」
 *      (UI 工作流编辑器从这张表读 agent 选项)
 *   2. 用该 preset id 构造 DSL
 *   3. 写入 workflows 表
 */

import {
  createWorkflow,
  listWorkflows,
  updateWorkflow,
} from '../src/lib/db/workflows';
import {
  createAgentPreset,
  getAgentPresetByName,
} from '../src/lib/db/agent-presets';
import { buildWorkflowDsl } from '../src/lib/workflow/presets/novel-trope-radar/workflow.dsl';
import { DEFAULT_RUN_PARAMS } from '../src/lib/workflow/presets/novel-trope-radar/types';

const NAME = '网文套路雷达';
const AGENT_NAME = '网文研究员';

function ensureAgentPreset(): string {
  const existing = getAgentPresetByName(AGENT_NAME);
  if (existing) return existing.id;
  const created = createAgentPreset({
    name: AGENT_NAME,
    roleKind: 'worker',
    responsibility:
      '抓取主流网文平台榜单/详情/试读章,产出结构化数据供下游分析',
    systemPrompt:
      '你是网文行业研究员。负责按代码脚本指令抓取平台公开榜单、'
      + '书籍简介、章节目录、平台标记的免费试读章节,以及公开书评。'
      + '不绕反爬,不抓付费内容,失败立即跳过。',
    description: '网文套路雷达 workflow 专用 agent,执行确定性的抓取与汇总',
    specialties: '网文平台数据采集、HTML 解析、跨平台聚合',
  });
  return created.id;
}

const agentPresetId = ensureAgentPreset();
const dsl = buildWorkflowDsl(DEFAULT_RUN_PARAMS, { agentPresetId });
const existing = listWorkflows().find((w) => w.name === NAME);

if (existing) {
  updateWorkflow(existing.id, { workflowDsl: dsl });
  console.log(JSON.stringify({ id: existing.id, status: 'updated' }));
} else {
  const created = createWorkflow({
    name: NAME,
    description:
      '每周抓取主流网文平台榜单 + 试读 + 书评,提取套路结构化字段,'
      + '与上周对比生成趋势周报,写入知识库供写作时 RAG 召回。'
      + '详见 docs/novel-trope-radar.md。',
    workflowDsl: dsl,
    isTemplate: false,
    createdBy: 'system',
  });
  console.log(JSON.stringify({ id: created.id, status: 'created' }));
}
