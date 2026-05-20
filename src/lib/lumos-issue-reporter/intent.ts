const EXPLICIT_BUG_SUBMIT_PATTERNS = [
  /(提|提交|上报|报|创建|新建|开)\s*(个|一个|一下|条)?\s*(bug|issue)/i,
  /(bug|issue)\s*(提|提交|上报|报|创建|新建|开)(一下|掉|了)?/i,
  /(报到|提交到|发到|同步到)\s*(github|git\s*hub|git)\s*(issue|issues)?/i,
];

export function isExplicitLumosBugIssueRequest(text: string): boolean {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (/(怎么|如何|怎样|可不可以|能不能|是否|是不是).{0,8}(提|提交|上报|报|创建|新建|开)\s*(bug|issue)/i.test(normalized)) {
    return false;
  }
  return EXPLICIT_BUG_SUBMIT_PATTERNS.some((pattern) => pattern.test(normalized));
}
