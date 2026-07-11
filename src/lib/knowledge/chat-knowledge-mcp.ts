import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { searchWithMeta } from './searcher';
import { createReadKnowledgeItemTool } from './knowledge-read-tool';
import type { KnowledgeOverrides } from '@/types';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const MAX_TOP_K = 10;

export const CHAT_KNOWLEDGE_MCP_SERVER_NAME = 'lumos-knowledge';

export const CHAT_KNOWLEDGE_MCP_SYSTEM_HINT = `
## 知识库深读

当前消息已启用 Lumos 知识库。系统会先注入一组初筛命中,这些内容只是摘要或片段,不是完整正文。

可用工具:
- \`mcp__lumos-knowledge__search_knowledge(query, top_k?)\`: 继续检索知识库,返回标题、来源、kb_uri 和命中片段。
- \`mcp__lumos-knowledge__read_knowledge_item(kb_uri, offset?, max_chars?)\`: 按 kb_uri 读取知识库中保存的正文全文。长文会分页返回;如果结果里 \`has_more: true\`,继续用 \`next_offset\` 读取后续正文。

使用规则:
- 需要总结整篇、核对细节、引用证据、比较原文、回答用户问“全文/原文/依据”时,先读取相关 \`kb_uri\` 的正文,不要只基于摘要下结论。
- 不要再说“我只能看到摘要和原文 URL”。正确表述是:当前先看到摘要/片段,需要时可以通过工具读取知识库正文;很长的条目可能需要分段读取。
`;

export interface CreateChatKnowledgeMcpServerOptions {
  tagIds?: string[];
  topK?: number;
  overrides?: KnowledgeOverrides;
}

export function createChatKnowledgeMcpServer(options?: CreateChatKnowledgeMcpServerOptions) {
  const overrideTopK = options?.overrides?.topK;
  const baseTopK = Number.isFinite(overrideTopK) && (overrideTopK as number) > 0
    ? Math.floor(overrideTopK as number)
    : (options?.topK ?? 5);
  const defaultTopK = Math.max(1, Math.min(baseTopK, MAX_TOP_K));
  const tagIds = Array.from(new Set(
    (options?.tagIds ?? []).map((tagId) => tagId.trim()).filter(Boolean),
  ));

  return createSdkMcpServer({
    name: CHAT_KNOWLEDGE_MCP_SERVER_NAME,
    tools: [
      createSearchKnowledgeTool(tagIds, defaultTopK, options?.overrides),
      createReadKnowledgeItemTool(),
    ],
  });
}

function createSearchKnowledgeTool(
  defaultTagIds: string[],
  defaultTopK: number,
  overrides: KnowledgeOverrides | undefined,
) {
  return tool(
    'search_knowledge',
    'Search Lumos local knowledge base. Returns matched snippets with kb_uri. '
      + 'After finding a relevant kb_uri, call read_knowledge_item when full text is needed.',
    {
      query: z.string().min(1).describe('Natural-language search query.'),
      top_k: z.number().int().min(1).max(MAX_TOP_K).optional()
        .describe(`Number of results. Defaults to ${defaultTopK}, max ${MAX_TOP_K}.`),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const topK = args.top_k
          ? Math.max(1, Math.min(args.top_k, MAX_TOP_K))
          : defaultTopK;
        const run = await searchWithMeta(args.query, {
          topK,
          tagIds: defaultTagIds.length > 0 ? defaultTagIds : undefined,
          retrievalMode: overrides?.retrievalMode,
          disableRewrite: overrides?.rewriteEnabled === false ? true : undefined,
          candidatePool: overrides?.candidatePool,
        });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              query: args.query,
              top_k: topK,
              applied_tag_ids: defaultTagIds,
              count: run.results.length,
              meta: run.meta,
              results: run.results.map((r) => ({
                kb_uri: r.kb_uri,
                title: r.item_title,
                source_path: r.source_path,
                source_type: r.source_type,
                collection: r.collection_name,
                score: Number(r.score.toFixed(4)),
                retrieval_mode: r.retrieval_mode,
                snippet: r.chunk_content,
                match_terms: r.match_terms,
              })),
            }, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }, null, 2) }],
          isError: true,
        };
      }
    },
  );
}
