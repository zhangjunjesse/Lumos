// #65:undici 的 `TypeError: fetch failed` 对用户是零信息的(报告者连续 4+ 次
// 只拿到裸 "fetch failed")。网络层失败必须翻译成「连不上谁 + 错误码 + 该查什么」;
// 非网络错误必须原样透传,不许吞语义。

import { explainNetworkError } from '../generate'
import { ImageGenError } from '../types'

const provider = { name: 'LumosPro', base_url: 'https://toapis.com' }

function fetchFailed(causeCode?: string, causeMsg = 'connect failed'): Error {
  const err = new TypeError('fetch failed')
  if (causeCode) {
    const cause = new Error(causeMsg) as Error & { code: string }
    cause.code = causeCode
    ;(err as Error & { cause: unknown }).cause = cause
  }
  return err
}

describe('explainNetworkError (#65)', () => {
  it('fetch failed + ENOTFOUND → 带主机名/错误码/排查方向的 ImageGenError', () => {
    const out = explainNetworkError(fetchFailed('ENOTFOUND', 'getaddrinfo ENOTFOUND toapis.com'), provider)
    expect(out).toBeInstanceOf(ImageGenError)
    const e = out as ImageGenError
    expect(e.code).toBe('provider_unavailable')
    expect(e.message).toContain('LumosPro')
    expect(e.message).toContain('toapis.com')
    expect(e.message).toContain('ENOTFOUND')
    expect(e.message).toContain('网络')
  })

  it('裸 fetch failed(无 cause)也翻译,不再裸奔', () => {
    const out = explainNetworkError(fetchFailed(), provider)
    expect(out).toBeInstanceOf(ImageGenError)
    expect((out as Error).message).toContain('toapis.com')
  })

  it('超时/连接被拒等常见网络码都识别', () => {
    for (const code of ['ETIMEDOUT', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT']) {
      const out = explainNetworkError(fetchFailed(code), provider)
      expect(out).toBeInstanceOf(ImageGenError)
      expect((out as Error).message).toContain(code)
    }
  })

  it('非网络错误原样透传(上游业务报错不能被吞)', () => {
    const biz = new ImageGenError('invalid_params', 'blend 需要 2-5 张图')
    expect(explainNetworkError(biz, provider)).toBe(biz)
    const generic = new Error('W8X task failed: image submit failed: 0')
    expect(explainNetworkError(generic, provider)).toBe(generic)
  })

  it('base_url 不是合法 URL 时原样展示,不崩', () => {
    const out = explainNetworkError(fetchFailed('ECONNREFUSED'), { name: 'X', base_url: '' })
    expect(out).toBeInstanceOf(ImageGenError)
    expect((out as Error).message).toContain('未配置 base_url')
  })
})
