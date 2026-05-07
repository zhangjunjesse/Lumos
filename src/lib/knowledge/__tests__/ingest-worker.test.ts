import { getTerminalIngestFailureReason } from '@/lib/knowledge/ingest-worker'

describe('knowledge ingest worker terminal failures', () => {
  test('turns exhausted token errors into a job-level stop reason', () => {
    const reason = getTerminalIngestFailureReason(
      new Error('该令牌额度已用尽 TokenStatusExhausted[sk-O3G***wxK]'),
    )

    expect(reason).toContain('余额或令牌额度已耗尽')
  })

  test('does not stop the whole ingest job for ordinary transient rate limits', () => {
    expect(getTerminalIngestFailureReason(new Error('429 rate limit'))).toBeNull()
  })
})

