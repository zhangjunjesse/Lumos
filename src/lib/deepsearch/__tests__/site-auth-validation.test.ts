import { validateDeepSearchSiteSessionFromPage } from '../site-auth-validation';

describe('deepsearch site auth validation', () => {
  it('blocks when validation url redirects to login', () => {
    const result = validateDeepSearchSiteSessionFromPage(
      {
        url: 'https://www.zhihu.com/signin?next=%2Fsettings%2Fprofile',
        title: 'Sign in',
        text: '登录/注册',
      },
      {
        loginUrlPatterns: [/zhihu\.com\/signin/i],
        loggedOutTextHints: ['登录/注册'],
      },
    );

    expect(result).toEqual({
      blocked: true,
      reason: 'Validation page redirected to a login URL: https://www.zhihu.com/signin?next=%2Fsettings%2Fprofile',
    });
  });

  it('blocks when validation page still shows login prompt text', () => {
    const result = validateDeepSearchSiteSessionFromPage(
      {
        url: 'https://mp.weixin.qq.com/',
        title: '微信公众平台',
        text: '请使用微信扫码登录',
      },
      {
        loggedOutTextHints: ['扫码登录'],
      },
    );

    expect(result).toEqual({
      blocked: true,
      reason: 'Validation page still shows a login prompt: 扫码登录',
    });
  });

  it('passes when there is no obvious login redirect or prompt', () => {
    const result = validateDeepSearchSiteSessionFromPage(
      {
        url: 'https://www.zhihu.com/settings/profile',
        title: '我的资料 - 知乎',
        text: '我的资料 个人信息 安全设置',
      },
      {
        loginUrlPatterns: [/zhihu\.com\/signin/i],
        loggedOutTextHints: ['登录/注册', '扫码登录'],
      },
    );

    expect(result).toEqual({
      blocked: false,
      reason: '',
    });
  });
});
