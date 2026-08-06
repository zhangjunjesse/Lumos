// 就近原则解析器 —— 覆盖所有优先级组合。这是全仓"用哪个图片服务商"的唯一决定点,
// 一旦错位,分流全乱、计费错服务商,所以每条分支都要钉死。

import { resolveImageProviderId } from '../image-provider-resolver'

describe('resolveImageProviderId 就近原则', () => {
  describe('无团队(主 AI 出图)', () => {
    it('会话选了 → 用会话的', () => {
      expect(resolveImageProviderId({ hasTeam: false, sessionImageProviderId: 'p-mj' })).toBe('p-mj')
    })
    it('会话没选 → undefined(交给全局默认)', () => {
      expect(resolveImageProviderId({ hasTeam: false, sessionImageProviderId: '' })).toBeUndefined()
      expect(resolveImageProviderId({ hasTeam: false })).toBeUndefined()
    })
    it('无团队时不看成员/团队字段', () => {
      expect(resolveImageProviderId({
        hasTeam: false,
        memberImageProviderId: 'p-member',
        teamDefaultImageProviderId: 'p-team',
        sessionImageProviderId: 'p-session',
      })).toBe('p-session')
    })
  })

  describe('有团队(成员出图)', () => {
    it('成员绑了 → 用成员的', () => {
      expect(resolveImageProviderId({ hasTeam: true, memberImageProviderId: 'p-mj' })).toBe('p-mj')
    })
    it('成员没绑、团队有默认 → 用团队默认', () => {
      expect(resolveImageProviderId({
        hasTeam: true, memberImageProviderId: '', teamDefaultImageProviderId: 'p-team',
      })).toBe('p-team')
    })
    it('成员和团队都没配 → undefined(全局默认)', () => {
      expect(resolveImageProviderId({ hasTeam: true })).toBeUndefined()
    })
    it('成员优先于团队默认', () => {
      expect(resolveImageProviderId({
        hasTeam: true, memberImageProviderId: 'p-member', teamDefaultImageProviderId: 'p-team',
      })).toBe('p-member')
    })
    it('有团队时刻意忽略会话级选择(不打乱团队分工)', () => {
      expect(resolveImageProviderId({
        hasTeam: true, memberImageProviderId: '', teamDefaultImageProviderId: '',
        sessionImageProviderId: 'p-session',
      })).toBeUndefined()
    })
  })

  describe('AI 逃生舱(明确指定)压过一切', () => {
    it('明确指定 > 会话', () => {
      expect(resolveImageProviderId({
        hasTeam: false, explicitProviderId: 'p-explicit', sessionImageProviderId: 'p-session',
      })).toBe('p-explicit')
    })
    it('明确指定 > 成员', () => {
      expect(resolveImageProviderId({
        hasTeam: true, explicitProviderId: 'p-explicit', memberImageProviderId: 'p-member',
      })).toBe('p-explicit')
    })
    it('空白的明确指定不生效,回落到就近链', () => {
      expect(resolveImageProviderId({
        hasTeam: false, explicitProviderId: '  ', sessionImageProviderId: 'p-session',
      })).toBe('p-session')
    })
  })

  it('空白字符串一律当未配置', () => {
    expect(resolveImageProviderId({ hasTeam: true, memberImageProviderId: '   ' })).toBeUndefined()
  })
})
