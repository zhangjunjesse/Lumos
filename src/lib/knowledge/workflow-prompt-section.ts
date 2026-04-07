/**
 * Prompt section 生成器 —— 为启用了知识库的 workflow agent 注入使用说明。
 *
 * 这个 section 会追加到 agent 的 systemPrompt 末尾,告诉模型:
 *   1. 可用的工具名(MCP scoped,形如 mcp__lumos-knowledge__search_knowledge)
 *   2. 默认标签范围
 *   3. 是否允许自行选择标签 + 可选标签清单
 *   4. 何时应该调用 search_knowledge
 */
import type { WorkflowKnowledgeConfig } from '@/lib/workflow/types';
import type { TagCatalogEntry } from './tag-resolver';

export const KNOWLEDGE_MCP_SERVER_NAME = 'lumos-knowledge';
export const KNOWLEDGE_SEARCH_TOOL_NAME = 'search_knowledge';
export const KNOWLEDGE_LIST_TAGS_TOOL_NAME = 'list_knowledge_tags';

function scopedTool(name: string): string {
  return `mcp__${KNOWLEDGE_MCP_SERVER_NAME}__${name}`;
}

export interface BuildKnowledgePromptSectionInput {
  config: WorkflowKnowledgeConfig;
  /** resolveTagNames 返回的命中标签名(大小写与 DB 一致) */
  resolvedTagNames: string[];
  /** 未命中的标签名,提示用户修正(可选,仅用于记录) */
  missingTagNames: string[];
  /** 允许 agent 挑选时,列出可选标签 catalog */
  catalog?: TagCatalogEntry[];
}

/**
 * 生成要追加到 systemPrompt 末尾的知识库使用说明。禁用或未启用时返回空字符串。
 */
export function buildKnowledgePromptSection(
  input: BuildKnowledgePromptSectionInput,
): string {
  const { config, resolvedTagNames, catalog } = input;
  if (!config.enabled) return '';

  const searchTool = scopedTool(KNOWLEDGE_SEARCH_TOOL_NAME);
  const listTool = scopedTool(KNOWLEDGE_LIST_TAGS_TOOL_NAME);

  const lines: string[] = [];
  lines.push('');
  lines.push('---');
  lines.push('## 知识库访问');
  lines.push('');
  lines.push(`你可以调用 \`${searchTool}\` 检索知识库内容。`);
  lines.push('');

  if (resolvedTagNames.length > 0) {
    lines.push(`**默认标签范围**(不传 \`tags\` 参数时生效):${resolvedTagNames.map((n) => `\`${n}\``).join(', ')}`);
  } else {
    lines.push('**默认标签范围**:无限制(检索全部知识库条目)');
  }
  lines.push('');

  if (config.allowAgentTagSelection) {
    lines.push('你可以根据用户问题自行选择更合适的标签,通过 `tags: string[]` 参数传入(使用标签名,不是 id)。');
    if (catalog && catalog.length > 0) {
      lines.push('');
      lines.push(`**可选标签**(按热度):${catalog.map((t) => `\`${t.name}\``).join(', ')}`);
      lines.push('');
      lines.push(`需要查看完整列表时调用 \`${listTool}\`。`);
    } else {
      lines.push(`可用 \`${listTool}\` 获取完整标签清单。`);
    }
  } else {
    lines.push('不要传入 `tags` 参数,始终使用默认标签范围。');
  }

  lines.push('');
  lines.push('**何时使用**:');
  lines.push('- 用户问题涉及的知识可能存在于知识库时,先检索再回答,不要凭空编造。');
  lines.push('- 第一次检索结果不理想时,可以换关键词或换标签再检索(最多 3 次)。');
  lines.push('- 回答中引用到的内容,请用 `kb_uri` 标注来源。');
  lines.push('---');

  return lines.join('\n');
}
