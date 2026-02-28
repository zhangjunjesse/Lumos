/**
 * 工具: feishu_doc_get_blocks - 获取文档块列表
 */
import { parseFeishuUrl, success, error } from '../utils/helpers.js';
import { getBlocks } from '../services/document.js';

export const name = 'feishu_doc_get_blocks';

export const description = '获取飞书文档的块列表。返回每个块的 ID、类型和文本内容，用于定位需要编辑的具体块。配合 feishu_doc_update_block 使用。';

export const inputSchema = {
  type: 'object',
  properties: {
    url: {
      type: 'string',
      description: '飞书文档 URL'
    }
  },
  required: ['url']
};

export async function handler({ url }) {
  try {
    const parsed = parseFeishuUrl(url);
    if (!parsed) return error('无效的飞书文档 URL');
    const result = await getBlocks(parsed);
    return success(result);
  } catch (err) {
    return error(err.message);
  }
}
