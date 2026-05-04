const EXPLICIT_BROWSER_RE = /浏览器|browser|chrome|adspower|profile|页面|网页|标签页|tab/i;
const BROWSER_ACTION_RE = /打开|访问|进入|前往|导航|浏览(?!器)|搜索|查询|查一下|查找|登录|点击|填写|截图|open|visit|go to|navigate|browse|search|login|click|fill|screenshot/i;
const WEB_TARGET_RE = /https?:\/\/|www\.|[a-z0-9-]+\.(?:com|cn|net|org|io|co|shop|store|dev|app|ai|xyz|top)\b|百度|谷歌|google|bing|etsy|淘宝|京东|网站|网页|页面|平台|店铺/i;
const VISIBLE_OPEN_RE = /打开|访问|进入|前往|导航|open|visit|go to|navigate/i;

export interface BrowserAutomationIntentInput {
  userInput: string;
  matchedBrowserContext?: boolean;
  selectedBrowserContextId?: string;
}

function hasSelectedExternalContext(contextId?: string): boolean {
  return Boolean(contextId && contextId.trim() && contextId.trim() !== 'embedded:default');
}

export function isBrowserAutomationRequest(input: BrowserAutomationIntentInput): boolean {
  const text = input.userInput.trim();
  if (!text) return false;

  const explicitBrowser = input.matchedBrowserContext === true || EXPLICIT_BROWSER_RE.test(text);
  const browserAction = BROWSER_ACTION_RE.test(text);
  const webTarget = WEB_TARGET_RE.test(text);

  if (explicitBrowser && browserAction) return true;
  return hasSelectedExternalContext(input.selectedBrowserContextId) && browserAction && webTarget;
}

export function prefersVisibleBrowserAction(input: BrowserAutomationIntentInput): boolean {
  const text = input.userInput.trim();
  if (!isBrowserAutomationRequest(input)) return false;
  return VISIBLE_OPEN_RE.test(text) && WEB_TARGET_RE.test(text);
}
