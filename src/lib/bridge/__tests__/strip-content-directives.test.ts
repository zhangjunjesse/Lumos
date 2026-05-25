// Isolated test for stripContentDirectives — does not need the heavy module
// mocks the rest of conversation-engine pulls in. Validates that the file
// directive is preserved (the rest of the IM history fallback depends on
// the absolute file path surviving this step).

jest.mock('@/lib/db', () => ({ dataDir: '/tmp/lumos-test-data' }), { virtual: true });
jest.mock('@/lib/mcp-resolver', () => ({}), { virtual: true });
jest.mock('@/lib/claude-client', () => ({}), { virtual: true });
jest.mock('@/lib/auth/user-service', () => ({}), { virtual: true });
jest.mock('@/lib/app/im-bridge', () => ({}), { virtual: true });
jest.mock('@/lib/im', () => ({}), { virtual: true });
jest.mock('@/lib/chat/session-entry', () => ({}), { virtual: true });
jest.mock('@/lib/chat/wechat-assistant-session', () => ({}), { virtual: true });
jest.mock('@/lib/chat/workflow-session', () => ({}), { virtual: true });
jest.mock('@/lib/chat/ecommerce-assistant-session', () => ({}), { virtual: true });
jest.mock('@/lib/chat/tool-trace-sanitizer', () => ({}), { virtual: true });
jest.mock('@/lib/agent-capabilities/registry', () => ({}), { virtual: true });

import { stripContentDirectives } from '../conversation-engine';

describe('stripContentDirectives', () => {
  it('removes routing-only directives (source, feishu_mentions)', () => {
    expect(stripContentDirectives('<!--source:wechat-->hello')).toBe('hello');
    expect(stripContentDirectives('<!--feishu_mentions:[{"id":"x"}]-->hi')).toBe('hi');
  });

  it('preserves <!--files:...--> so the on-disk path reaches the history normalizer', () => {
    const raw = '<!--files:[{"name":"foo.m4a","filePath":"/abs/foo.m4a"}]--><!--source:wechat-->hello';
    const out = stripContentDirectives(raw);
    expect(out).toContain('<!--files:');
    expect(out).toContain('/abs/foo.m4a');
    expect(out).not.toContain('<!--source:wechat-->');
    expect(out.endsWith('hello')).toBe(true);
  });

  it('returns trimmed empty string for input that is only directives', () => {
    expect(stripContentDirectives('<!--source:wechat-->')).toBe('');
  });
});
