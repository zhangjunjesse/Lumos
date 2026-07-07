import { classifyTerminalLlmError } from '@/lib/llm-error-classifier'

describe('llm-error-classifier', () => {
  test('classifies new-api exhausted token errors as terminal quota errors', () => {
    const error = new Error('429 Too Many Requests: 该令牌额度已用尽 TokenStatusExhausted[sk-O3G***wxK]')

    expect(classifyTerminalLlmError(error)).toMatchObject({
      code: 'llm_quota_exhausted',
      retryable: false,
    })
  })

  test('classifies 402 and insufficient quota responses as terminal quota errors', () => {
    const error = {
      statusCode: 402,
      response: {
        data: {
          error: {
            code: 'insufficient_quota',
            message: 'credit balance is too low',
          },
        },
      },
    }

    expect(classifyTerminalLlmError(error)).toMatchObject({
      code: 'llm_quota_exhausted',
      retryable: false,
    })
  })

  test('classifies quota errors surfaced only in CLI stderr', () => {
    // The Claude Agent SDK spawns the `claude` CLI; the upstream gateway text
    // lands in stderr while error.message is just "exited with code 1".
    const error = Object.assign(new Error('Claude Code process exited with code 1'), {
      stderr: '429 Too Many Requests: 该令牌额度已用尽 TokenStatusExhausted[sk-O3G***wxK]',
    })

    expect(classifyTerminalLlmError(error)).toMatchObject({
      code: 'llm_quota_exhausted',
      retryable: false,
    })
  })

  test('classifies auth failures as terminal auth errors', () => {
    const error = { status: 401, message: 'invalid api key' }

    expect(classifyTerminalLlmError(error)).toMatchObject({
      code: 'llm_auth_failed',
      retryable: false,
    })
  })

  test('does not mark ordinary rate limits as terminal', () => {
    expect(classifyTerminalLlmError(new Error('429 rate limit'))).toBeNull()
  })
})

