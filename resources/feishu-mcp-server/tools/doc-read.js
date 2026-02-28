/**
 * 工具: feishu_doc_read - 读取飞书文档内容
 */
import { parseFeishuUrl, success, error } from '../utils/helpers.js';
import { readDocument } from '../services/document.js';

export const name = 'feishu_doc_read';

export const description = '读取飞书文档内容并返回 Markdown 格式。支持 docx、wiki、docs 类型文档。图片以 [图片N] 占位符表示，可通过 feishu_image_download 获取。';

export const inputSchema = {
  type: 'object',
  properties: {
    url: {
      type: 'string',
      description: '飞书文档 URL，支持格式：feishu.cn/docx/xxx、feishu.cn/wiki/xxx、feishu.cn/docs/xxx'
    },
    format: {
      type: 'string',
      enum: ['markdown', 'plain'],
      default: 'markdown',
      description: '输出格式。markdown 保留标题/列表/表格等格式，plain 为纯文本'
    }
  },
  required: ['url']
};

export async function handler({ url, format }) {
  try {
    const parsed = parseFeishuUrl(url);
    if (!parsed) return error('无效的飞书文档 URL');
    if (parsed.type === 'sheets') return error('这是电子表格 URL，请使用 feishu_sheet_read');

    const result = await readDocument(parsed, format || 'markdown');
    return success(result);
  } catch (err) {
    return error(err.message);
  }
}
