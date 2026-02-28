/**
 * 工具: feishu_doc_append - 追加内容到文档末尾
 */
import { parseFeishuUrl, success, error } from '../utils/helpers.js';
import { appendToDocument } from '../services/document.js';

export const name = 'feishu_doc_append';

export const description = '在飞书文档末尾追加文本内容。适用于向已有文档添加新段落、笔记等场景。';

export const inputSchema = {
  type: 'object',
  properties: {
    url: {
      type: 'string',
      description: '飞书文档 URL'
    },
    content: {
      type: 'string',
      description: '要追加的文本内容'
    }
  },
  required: ['url', 'content']
};

export async function handler({ url, content }) {
  try {
    const parsed = parseFeishuUrl(url);
    if (!parsed) return error('无效的飞书文档 URL');
    const result = await appendToDocument(parsed, content);
    return success(result);
  } catch (err) {
    return error(err.message);
  }
}
