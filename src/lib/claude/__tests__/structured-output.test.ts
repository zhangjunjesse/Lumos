import { z } from 'zod';

const mockQuery = jest.fn();
const mockGetSession = jest.fn();
const mockBuildClaudeSdkRuntimeBootstrap = jest.fn(() => ({
  env: {
    ANTHROPIC_AUTH_TOKEN: 'test-token',
  },
  settingSources: ['project'],
  pathToClaudeCodeExecutable: '/tmp/claude-code',
}));

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock('@/lib/db/sessions', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

jest.mock('@/lib/claude/sdk-runtime', () => ({
  buildClaudeSdkRuntimeBootstrap: (...args: unknown[]) => mockBuildClaudeSdkRuntimeBootstrap(...args),
}));

async function* streamMessages(messages: unknown[]) {
  for (const message of messages) {
    yield message;
  }
}

describe('generateObjectWithClaudeSdk', () => {
  beforeEach(() => {
    jest.resetModules();
    mockQuery.mockReset();
    mockGetSession.mockReset();
    mockBuildClaudeSdkRuntimeBootstrap.mockClear();
    mockGetSession.mockReturnValue({
      sdk_cwd: '/tmp/session-cwd',
      working_directory: '/tmp/fallback-cwd',
    });
  });

  test('returns Claude structured_output when present', async () => {
    mockQuery.mockReturnValue(streamMessages([
      {
        type: 'result',
        structured_output: {
          strategy: 'simple',
          reason: 'done',
        },
      },
    ]));

    const { generateObjectWithClaudeSdk } = await import('../structured-output');
    const result = await generateObjectWithClaudeSdk({
      system: 'system',
      prompt: 'prompt',
      schema: z.object({
        strategy: z.literal('simple'),
        reason: z.string(),
      }),
      sessionId: 'session-test-001',
    });

    expect(result).toEqual({
      strategy: 'simple',
      reason: 'done',
    });
    expect(mockQuery).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        cwd: '/tmp/session-cwd',
        env: {
          ANTHROPIC_AUTH_TOKEN: 'test-token',
        },
        settingSources: ['project'],
        pathToClaudeCodeExecutable: '/tmp/claude-code',
        permissionMode: 'plan',
        outputFormat: expect.objectContaining({
          type: 'json_schema',
        }),
      }),
    }));
  });

  test('parses valid JSON text from the final result when structured_output is missing', async () => {
    mockQuery.mockReturnValue(streamMessages([
      { text: '{"strategy":"wrong"}' },
      {
        type: 'result',
        result: '```json\n{"strategy":"workflow","reason":"from-text"}\n```',
      },
    ]));

    const { generateObjectWithClaudeSdk } = await import('../structured-output');
    const result = await generateObjectWithClaudeSdk({
      system: 'system',
      prompt: 'prompt',
      schema: z.object({
        strategy: z.literal('workflow'),
        reason: z.string(),
      }),
      sessionId: 'session-test-001',
    });

    expect(result).toEqual({
      strategy: 'workflow',
      reason: 'from-text',
    });
  });

  test('fails clearly when Claude only returns invalid JSON text', async () => {
    mockQuery.mockReturnValue(streamMessages([
      {
        type: 'result',
        result: '```json\n{"strategy":"workflow",}\n```',
      },
    ]));

    const { generateObjectWithClaudeSdk } = await import('../structured-output');

    await expect(generateObjectWithClaudeSdk({
      system: 'system',
      prompt: 'prompt',
      schema: z.object({
        strategy: z.string(),
      }),
      sessionId: 'session-test-001',
    })).rejects.toMatchObject({
      message: expect.stringContaining('Claude SDK returned text output but it was not valid JSON'),
      outputPreview: '```json\n{"strategy":"workflow",}\n```',
    });
  });

  test('preserves timeout-like abort details when the caller aborts the request', async () => {
    const abortController = new AbortController();
    abortController.abort({
      name: 'TimeoutError',
      message: 'LLM planning timed out after 90000ms',
    });

    mockQuery.mockReturnValue((async function* failingConversation() {
      throw new Error('Claude Code process aborted by user');
    }()));

    const { generateObjectWithClaudeSdk } = await import('../structured-output');

    await expect(generateObjectWithClaudeSdk({
      system: 'system',
      prompt: 'prompt',
      schema: z.object({
        strategy: z.string(),
      }),
      sessionId: 'session-test-001',
      abortSignal: abortController.signal,
    })).rejects.toMatchObject({
      name: 'TimeoutError',
      message: 'LLM planning timed out after 90000ms',
    });
  });
});
