// 产出路径追踪的形状回归:SDK 0.3.207 实测 PostToolUse 的 tool_response 是 content 块数组
// **本身**(不带 {content} 包裹)——上过一次当(全部产出被误滤),用测试钉死。

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
  tool: jest.fn(() => ({})),
  createSdkMcpServer: jest.fn(() => ({})),
}));
jest.mock('@/lib/claude/sdk-runtime', () => ({ buildClaudeSdkInvocationContext: jest.fn() }));
jest.mock('@/lib/claude/provider-env', () => ({ isClaudeLocalAuthProvider: jest.fn(() => false) }));
jest.mock('@/lib/claude/local-auth', () => ({ ensureClaudeLocalAuthReady: jest.fn() }));
jest.mock('@/lib/tools/lumos-mcp-server', () => ({
  createLumosMcpServer: jest.fn(() => ({})),
  LUMOS_MCP_SERVER_NAME: 'lumos-image',
}));

import { collectProducedPaths } from '../team-session';

const TOOL = 'mcp__lumos-image__generate_image';

describe('collectProducedPaths', () => {
  it('SDK 真实形状(tool_response=content 数组本身)能收集到 images[].path', () => {
    const sink = new Set<string>();
    collectProducedPaths(
      {
        tool_name: TOOL,
        tool_response: [{ type: 'text', text: JSON.stringify({ success: true, images: [{ path: '/a.png' }, { path: '/b.png' }] }) }],
      },
      sink,
    );
    expect([...sink].sort()).toEqual(['/a.png', '/b.png']);
  });

  it('其他工具/非数组响应/非 JSON 文本 都安静跳过', () => {
    const sink = new Set<string>();
    collectProducedPaths({ tool_name: 'Read', tool_response: [{ type: 'text', text: '{"images":[{"path":"/x.png"}]}' }] }, sink);
    collectProducedPaths({ tool_name: TOOL, tool_response: { content: [] } }, sink); // 老假设的包裹形状:不认
    collectProducedPaths({ tool_name: TOOL, tool_response: [{ type: 'text', text: '生成失败:配额不足' }] }, sink);
    expect(sink.size).toBe(0);
  });
});
