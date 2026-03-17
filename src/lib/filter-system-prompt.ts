/**
 * 过滤消息中的系统提示部分
 * 移除 <!--system-prompt-->...<!--/system-prompt--> 包裹的内容
 */
export function filterSystemPrompt(content: string): string {
  return content.replace(/<!--system-prompt-->[\s\S]*?<!--\/system-prompt-->/g, '').trim();
}
