jest.mock('@anthropic-ai/claude-agent-sdk', () => {
  const tools: Array<{ name: string; description: string; schema: unknown; handler: unknown }> = [];
  return {
    tool: jest.fn((name: string, description: string, schema: unknown, handler: unknown) => {
      const def = { name, description, schema, handler };
      tools.push(def);
      return def;
    }),
    createSdkMcpServer: jest.fn((cfg: { name: string; tools: Array<{ name: string; handler: unknown }> }) => ({
      type: 'sdk',
      name: cfg.name,
      tools: cfg.tools,
    })),
    __toolRegistry: tools,
  };
});

const searchWithMetaMock = jest.fn();
jest.mock('../searcher', () => ({
  searchWithMeta: (...args: unknown[]) => searchWithMetaMock(...args),
}));

jest.mock('../knowledge-read-tool', () => ({
  createReadKnowledgeItemTool: jest.fn(() => ({ name: 'read_knowledge_item' })),
}));

import { createChatKnowledgeMcpServer, CHAT_KNOWLEDGE_MCP_SERVER_NAME } from '../chat-knowledge-mcp';

interface CreatedServer {
  type: 'sdk';
  name: string;
  tools: Array<{ name: string; handler: (args: unknown) => Promise<{ content: Array<{ text: string }> }> }>;
}

function getSearchHandler(server: CreatedServer) {
  const search = server.tools.find((t) => t.name === 'search_knowledge');
  if (!search) throw new Error('search_knowledge tool not registered');
  return search.handler;
}

describe('chat-knowledge MCP server', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    searchWithMetaMock.mockResolvedValue({ results: [], meta: { queryVariants: [], retrievalMode: 'reference', timeFilter: null, candidateItems: 0, candidateChunks: 0 } });
  });

  test('uses lumos-knowledge as the MCP server name', () => {
    const server = createChatKnowledgeMcpServer() as unknown as CreatedServer;
    expect(server.name).toBe(CHAT_KNOWLEDGE_MCP_SERVER_NAME);
    expect(server.name).toBe('lumos-knowledge');
  });

  test('registers both search_knowledge and read_knowledge_item tools', () => {
    const server = createChatKnowledgeMcpServer() as unknown as CreatedServer;
    const names = server.tools.map((t) => t.name).sort();
    expect(names).toEqual(['read_knowledge_item', 'search_knowledge']);
  });

  test('forwards user retrieval overrides to searchWithMeta', async () => {
    const server = createChatKnowledgeMcpServer({
      tagIds: ['tag-a', '  tag-b  ', '', 'tag-a'],
      overrides: {
        retrievalMode: 'enhanced',
        rewriteEnabled: false,
        topK: 7,
        candidatePool: 50,
      },
    }) as unknown as CreatedServer;

    const handler = getSearchHandler(server);
    await handler({ query: '示例问题' });

    expect(searchWithMetaMock).toHaveBeenCalledWith('示例问题', expect.objectContaining({
      topK: 7,
      tagIds: ['tag-a', 'tag-b'],
      retrievalMode: 'enhanced',
      disableRewrite: true,
      candidatePool: 50,
    }));
  });

  test('omits disableRewrite when rewrite stays enabled (default)', async () => {
    const server = createChatKnowledgeMcpServer({
      overrides: { rewriteEnabled: true },
    }) as unknown as CreatedServer;

    const handler = getSearchHandler(server);
    await handler({ query: 'q' });

    const call = searchWithMetaMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(call.disableRewrite).toBeUndefined();
  });

  test('clamps explicit top_k argument to MAX_TOP_K=10', async () => {
    const server = createChatKnowledgeMcpServer() as unknown as CreatedServer;
    const handler = getSearchHandler(server);
    await handler({ query: 'q', top_k: 999 });

    const call = searchWithMetaMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(call.topK).toBe(10);
  });

  test('falls back to default top_k=5 when not provided and no overrides set it', async () => {
    const server = createChatKnowledgeMcpServer() as unknown as CreatedServer;
    const handler = getSearchHandler(server);
    await handler({ query: 'q' });

    const call = searchWithMetaMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(call.topK).toBe(5);
  });
});
