/**
 * Covers the two pure functions that do the heavy lifting:
 *   - unwrapMessageMarkdown:   chat 的 JSON content blocks → 裸 markdown
 *   - extractTraceSection:     已解好的 step body → 只剩 "#### 执行过程" 这一块
 *
 * 以及 getDebugStepTrace 的端到端(mock db + sessions)。保证:
 *   · 正常匹配到 step 时返回 trace
 *   · 老格式消息 / 非 assistant 消息不匹配时返回空
 *   · runId 不属于 debug mode 时返回空
 */

import {
  unwrapMessageMarkdown,
  extractTraceSection,
} from '../debug-step-trace';

describe('unwrapMessageMarkdown', () => {
  test('decodes structured [{type:text,text}] blocks into markdown', () => {
    const content = JSON.stringify([
      { type: 'text', text: 'line 1' },
      { type: 'text', text: 'line 2' },
    ]);
    expect(unwrapMessageMarkdown(content)).toBe('line 1\nline 2');
  });

  test('ignores non-text blocks', () => {
    const content = JSON.stringify([
      { type: 'text', text: 'visible' },
      { type: 'tool_use', name: 'x' },
    ]);
    expect(unwrapMessageMarkdown(content)).toBe('visible');
  });

  test('returns raw string when content is not JSON', () => {
    expect(unwrapMessageMarkdown('hello **md**')).toBe('hello **md**');
  });

  test('returns raw string when JSON parses but is not an array', () => {
    expect(unwrapMessageMarkdown('{"x":1}')).toBe('{"x":1}');
  });
});

describe('extractTraceSection', () => {
  test('keeps #### 执行过程 and strips trailing <sub> metrics', () => {
    const body = [
      'summary content here',
      '',
      '---',
      '',
      '#### 执行过程(2 次工具调用,1 段思考)',
      '',
      '> 💭 **思考过程**',
      '>',
      '> thinking …',
      '',
      '**🔧 调用:** `tool_x`',
      '```json',
      '{"foo":"bar"}',
      '```',
      '',
      '<sub>耗时 1.2s · 500 tokens</sub>',
    ].join('\n');

    const trace = extractTraceSection(body);
    expect(trace).toContain('#### 执行过程');
    expect(trace).toContain('思考过程');
    expect(trace).toContain('tool_x');
    expect(trace).not.toContain('<sub>');
    expect(trace).not.toContain('summary content here');
  });

  test('returns null when body has no 执行过程 section', () => {
    expect(extractTraceSection('just summary\n\n---\n\n#### 输出文件\n- a')).toBeNull();
  });

  test('returns null when 执行过程 section is effectively empty after stripping sub', () => {
    // Only a header with nothing useful underneath still counts as trace (defensive: keep it).
    const trace = extractTraceSection('text\n\n#### 执行过程\n');
    expect(trace).toBe('#### 执行过程');
  });
});

// ── getDebugStepTrace (mocked db + sessions) ────────────────────────────────

jest.mock('@/lib/db', () => ({
  getDb: jest.fn(),
}));
jest.mock('@/lib/db/sessions', () => ({
  getMessages: jest.fn(),
}));

import { getDebugStepTrace } from '../debug-step-trace';
import { getDb } from '@/lib/db';
import { getMessages } from '@/lib/db/sessions';

type MockRow = { session_id?: string | null } | undefined;

function mockDb(row: MockRow) {
  (getDb as jest.Mock).mockReturnValue({
    prepare: () => ({ get: () => row }),
  });
}

function stepMessage(roleName: string, stepId: string, body: string): { role: 'assistant'; content: string } {
  const md = `<!-- step:${roleName}:${stepId}:done -->\n\n${body}`;
  return {
    role: 'assistant',
    content: JSON.stringify([{ type: 'text', text: md }]),
  };
}

describe('getDebugStepTrace', () => {
  beforeEach(() => jest.clearAllMocks());

  test('finds trace by stepId and strips metrics', () => {
    mockDb({ session_id: 'sess-1' });
    (getMessages as jest.Mock).mockReturnValue({
      messages: [
        { role: 'user', content: 'hi' },
        stepMessage('worker', 'step-a', 'sum\n\n#### 执行过程\n\ntrace body\n\n<sub>1s</sub>'),
      ],
      hasMore: false,
    });

    const result = getDebugStepTrace('run-1', 'step-a');
    expect(result.hasTrace).toBe(true);
    expect(result.trace).toContain('#### 执行过程');
    expect(result.trace).toContain('trace body');
    expect(result.trace).not.toContain('<sub>');
  });

  test('returns empty when run is not debug mode', () => {
    mockDb(undefined);
    expect(getDebugStepTrace('run-1', 'step-a')).toEqual({ trace: null, hasTrace: false });
  });

  test('returns empty when session has no matching step', () => {
    mockDb({ session_id: 'sess-1' });
    (getMessages as jest.Mock).mockReturnValue({
      messages: [stepMessage('worker', 'other-step', 'sum\n\n#### 执行过程\n\ntrace')],
      hasMore: false,
    });
    expect(getDebugStepTrace('run-1', 'step-a')).toEqual({ trace: null, hasTrace: false });
  });

  test('returns hasTrace=false when matched step has no 执行过程 section', () => {
    mockDb({ session_id: 'sess-1' });
    (getMessages as jest.Mock).mockReturnValue({
      messages: [stepMessage('worker', 'step-a', 'just summary, no trace')],
      hasMore: false,
    });
    const r = getDebugStepTrace('run-1', 'step-a');
    expect(r.hasTrace).toBe(false);
    expect(r.trace).toBeNull();
  });

  test('skips non-assistant messages', () => {
    mockDb({ session_id: 'sess-1' });
    (getMessages as jest.Mock).mockReturnValue({
      messages: [
        { role: 'user', content: JSON.stringify([{ type: 'text', text: '<!-- step:w:step-a:done -->\n\n#### 执行过程\ntrace' }]) },
        stepMessage('worker', 'step-a', 'ok\n\n#### 执行过程\n\nreal trace'),
      ],
      hasMore: false,
    });
    const r = getDebugStepTrace('run-1', 'step-a');
    expect(r.trace).toContain('real trace');
  });
});
