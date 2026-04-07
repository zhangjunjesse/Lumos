/**
 * In-process SDK tools for workflow agents —— 知识库检索
 *
 * 通过 createSdkMcpServer 暴露给 Claude Agent SDK,走进程内通道,无 stdio 子进程。
 * 仅在 workflow agent 步骤且用户显式启用时注入;chat 不使用本模块。
 */
import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { searchWithMeta } from './searcher';
import { resolveTagNames, listTagCatalog } from './tag-resolver';
import type { WorkflowKnowledgeConfig } from '@/lib/workflow/types';

interface CallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

const MAX_TOP_K = 10;

export function createKnowledgeMcpServer(config: WorkflowKnowledgeConfig) {
  const defaultTopK = Math.max(1, Math.min(config.topK ?? 5, MAX_TOP_K));
  // 预解析默认标签(启动期),避免每次调用都查 DB;缺失不报错,仅忽略
  const { ids: defaultTagIds } = resolveTagNames(config.defaultTagNames ?? []);

  return createSdkMcpServer({
    name: 'lumos-knowledge',
    tools: [
      createSearchKnowledgeTool(config, defaultTagIds, defaultTopK),
      createListKnowledgeTagsTool(),
    ],
  });
}

function createSearchKnowledgeTool(
  config: WorkflowKnowledgeConfig,
  defaultTagIds: string[],
  defaultTopK: number,
) {
  const schema = {
    query: z.string().min(1).describe('自然语言检索词,建议使用中文关键词。'),
    tags: z
      .array(z.string().min(1))
      .optional()
      .describe(
        config.allowAgentTagSelection
          ? '可选:覆盖默认标签范围。传入标签名数组(不是 id),大小写敏感。未传则使用步骤默认标签。'
          : '忽略该参数——步骤策略不允许自选标签,始终使用默认范围。',
      ),
    topK: z
      .number()
      .int()
      .min(1)
      .max(MAX_TOP_K)
      .optional()
      .describe(`返回条数,默认 ${defaultTopK},最大 ${MAX_TOP_K}。`),
  };

  return tool(
    'search_knowledge',
    '检索 Lumos 本地知识库(BM25+向量混合召回)。' +
    '返回匹配的文档片段,包含 kb_uri、标题、来源路径、分数、内容片段。' +
    '适用于需要查阅既有资料再回答的场景。',
    schema,
    async (args): Promise<CallToolResult> => {
      try {
        let tagIds = defaultTagIds;
        let tagWarning: string | undefined;

        if (config.allowAgentTagSelection && Array.isArray(args.tags) && args.tags.length > 0) {
          const resolved = resolveTagNames(args.tags);
          tagIds = resolved.ids;
          if (resolved.missing.length > 0) {
            tagWarning = `以下标签不存在已忽略: ${resolved.missing.join(', ')}`;
          }
          // 如果全部未命中,退化为不过滤而不是直接失败——让模型看到 warning 决定下一步
          if (tagIds.length === 0) {
            tagIds = defaultTagIds;
          }
        }

        const topK = args.topK
          ? Math.max(1, Math.min(args.topK, MAX_TOP_K))
          : defaultTopK;

        const run = await searchWithMeta(args.query, {
          topK,
          tagIds: tagIds.length > 0 ? tagIds : undefined,
        });

        const body = {
          query: args.query,
          topK,
          appliedTagIds: tagIds,
          count: run.results.length,
          meta: run.meta,
          ...(tagWarning ? { warning: tagWarning } : {}),
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
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: false, error: message }, null, 2),
          }],
          isError: true,
        };
      }
    },
  );
}

function createListKnowledgeTagsTool() {
  const schema = {
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('返回数量,默认 50,按热度降序。'),
  };

  return tool(
    'list_knowledge_tags',
    '列出知识库中可用的标签(名称、分类、使用次数)。在不确定该用哪个标签时调用。',
    schema,
    async (args): Promise<CallToolResult> => {
      try {
        const entries = listTagCatalog({ limit: args.limit ?? 50 });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ count: entries.length, tags: entries }, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: false, error: message }, null, 2),
          }],
          isError: true,
        };
      }
    },
  );
}
