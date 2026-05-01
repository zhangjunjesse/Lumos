import {
  isBrowserAutomationRequest,
  prefersVisibleBrowserAction,
} from '../chat-intent';

describe('browser provider chat intent', () => {
  test('detects explicit configured browser open request', () => {
    const input = {
      userInput: '用浏览器1 打开 百度',
      matchedBrowserContext: true,
      selectedBrowserContextId: 'adspower:k1c1fbjj',
    };

    expect(isBrowserAutomationRequest(input)).toBe(true);
    expect(prefersVisibleBrowserAction(input)).toBe(true);
  });

  test('does not treat configuration questions as browser automation', () => {
    expect(isBrowserAutomationRequest({
      userInput: '浏览器1 要怎么配置在 Lumos 里面？',
      matchedBrowserContext: true,
      selectedBrowserContextId: 'adspower:k1c1fbjj',
    })).toBe(false);
  });

  test('uses selected external context for web navigation without repeating profile name', () => {
    expect(isBrowserAutomationRequest({
      userInput: '打开 https://www.baidu.com',
      selectedBrowserContextId: 'adspower:k1c1fbjj',
    })).toBe(true);
  });
});
