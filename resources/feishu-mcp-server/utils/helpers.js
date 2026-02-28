/**
 * 通用工具函数
 */

/**
 * 从飞书 URL 解析文档 ID 和类型
 * @param {string} url - 飞书文档 URL
 * @returns {{ docId: string, type: string } | null}
 */
export function parseFeishuUrl(url) {
  // 电子表格
  const sheetsMatch = url.match(/feishu\.cn\/sheets\/([a-zA-Z0-9]+)/);
  if (sheetsMatch) return { docId: sheetsMatch[1], type: 'sheets' };

  const patterns = [
    /feishu\.cn\/docx\/([a-zA-Z0-9]+)/,
    /feishu\.cn\/wiki\/([a-zA-Z0-9]+)/,
    /feishu\.cn\/docs\/([a-zA-Z0-9]+)/,
    /larksuite\.com\/docx\/([a-zA-Z0-9]+)/,
    /larksuite\.com\/wiki\/([a-zA-Z0-9]+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      const type = url.includes('/wiki/') ? 'wiki' : 'docx';
      return { docId: match[1], type };
    }
  }
  return null;
}

/**
 * 从块中提取文本内容
 */
export function extractBlockText(block) {
  if (!block) return '';
  const textBlock = block.text || block.heading1 || block.heading2 || block.heading3 ||
    block.heading4 || block.heading5 || block.heading6 || block.heading7 ||
    block.heading8 || block.heading9 || block.bullet || block.ordered ||
    block.code || block.quote;
  if (!textBlock || !textBlock.elements) return '';
  return textBlock.elements.map(el => el.text_run?.content || '').join('');
}

/**
 * 构建 MCP 工具成功响应
 */
export function success(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/**
 * 构建 MCP 工具错误响应
 */
export function error(message) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}
