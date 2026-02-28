/**
 * 工具: feishu_doc_overwrite - 覆盖文档全部内容
 */
import { parseFeishuUrl, success, error } from '../utils/helpers.js';
import { overwriteDocument } from '../services/document.js';

export const name = 'feishu_doc_overwrite';

export const description = '覆盖飞书文档全部内容。删除所有现有块后用新内容重写。注意：此操作不可逆。';

export const inputSchema = {
  type: 'object',
  properties: {
    url: {
      type: 'string',
      description: '飞书文档 URL'
    },
    markdown: {
      type: 'string',
      description: '新的文档内容，Markdown 格式'
    }
  },
  required: ['url', 'markdown']
};

export async function handler({ url, markdown }) {
  try {
    const parsed = parseFeishuUrl(url);
    if (!parsed) return error('无效的飞书文档 URL');
    const result = await overwriteDocument(parsed, markdown);
    return success(result);
  } catch (err) {
    return error(err.message);
  }
}
