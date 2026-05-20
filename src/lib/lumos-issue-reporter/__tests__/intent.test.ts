import { isExplicitLumosBugIssueRequest } from '../intent';

describe('isExplicitLumosBugIssueRequest', () => {
  test.each([
    '提bug。抖音采集需要支持复制打开抖音的分享链接',
    '帮我提交一个 bug 到 GitHub',
    '这个问题报到 github issue',
    '请创建 issue：主 Agent 回复不对',
    'bug提交到哪里了？',
  ])('detects explicit issue submission intent: %s', (input) => {
    expect(isExplicitLumosBugIssueRequest(input)).toBe(true);
  });

  test.each([
    '这个可能是一个 bug',
    '怎么提 bug 比较好？',
    '解释一下 GitHub issue 是什么',
    '抖音采集失败了，先帮我看看原因',
  ])('does not detect weak or informational bug mentions: %s', (input) => {
    expect(isExplicitLumosBugIssueRequest(input)).toBe(false);
  });
});
