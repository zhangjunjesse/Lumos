const settings: Record<string, string> = {}
jest.mock('@/lib/db', () => ({ getSetting: (k: string) => settings[k] || '' }))

import { applyConfiguredProxyToEnv } from '../proxy-settings'

beforeEach(() => {
  for (const k of Object.keys(settings)) delete settings[k]
})

describe('applyConfiguredProxyToEnv（本地 Claude 子进程代理注入）', () => {
  it('custom 模式：注入 HTTP/HTTPS_PROXY，并本地豁免 127.0.0.1', () => {
    settings['network.proxy.mode'] = 'custom'
    settings['network.proxy.https'] = 'http://127.0.0.1:7897'
    const env: Record<string, string> = {}
    applyConfiguredProxyToEnv(env)
    expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:7897')
    expect(env.HTTP_PROXY).toBe('http://127.0.0.1:7897') // https 缺 http 时互相回落
    expect(env.NO_PROXY).toContain('127.0.0.1')
  })

  it('off 模式：清掉继承自 OS 的代理键（本地 Claude 直连）', () => {
    settings['network.proxy.mode'] = 'off'
    const env: Record<string, string> = { HTTP_PROXY: 'http://os:1', HTTPS_PROXY: 'http://os:1' }
    applyConfiguredProxyToEnv(env)
    expect(env.HTTP_PROXY).toBeUndefined()
    expect(env.HTTPS_PROXY).toBeUndefined()
  })

  it('system 模式：用 OS 环境里的代理', () => {
    settings['network.proxy.mode'] = 'system'
    const prev = process.env.HTTPS_PROXY
    process.env.HTTPS_PROXY = 'http://os-proxy:1080'
    try {
      const env: Record<string, string> = {}
      applyConfiguredProxyToEnv(env)
      expect(env.HTTPS_PROXY).toBe('http://os-proxy:1080')
    } finally {
      if (prev === undefined) delete process.env.HTTPS_PROXY
      else process.env.HTTPS_PROXY = prev
    }
  })

  it('未配代理（system 但 OS 无代理）→ 不动 env', () => {
    settings['network.proxy.mode'] = 'system'
    const prev = process.env.HTTPS_PROXY
    const prevH = process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    delete process.env.HTTP_PROXY
    try {
      const env: Record<string, string> = {}
      applyConfiguredProxyToEnv(env)
      expect(env.HTTPS_PROXY).toBeUndefined()
      expect(env.HTTP_PROXY).toBeUndefined()
    } finally {
      if (prev !== undefined) process.env.HTTPS_PROXY = prev
      if (prevH !== undefined) process.env.HTTP_PROXY = prevH
    }
  })
})
