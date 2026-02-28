/**
 * 工具: feishu_doc_update_block - 更新指定块内容
 */
import { parseFeishuUrl, success, error } from '../utils/helpers.js';
import { updateBlock } from '../services/document.js';

export const name = 'feishu_doc_update_block';

export const description = '更新飞书文档中指定块的内容。需先用 feishu_doc_get_blocks 获取目标 block_id。';

export const inputSchema = {
  type: 'object',
  properties: {
    url: {
      type: 'string',
      description: '飞书文档 URL'
    },
    block_id: {
      type: 'string',
      description: '要更新的块 ID，通过 feishu_doc_get_blocks 获取'
    },
    content: {
      type: 'string',
      description: '新内容文本'
    }
  },
  required: ['url', 'block_id', 'content']
};

export async function handler({ url, block_id, content }) {
  try {
    const parsed = parseFeishuUrl(url);
    if (!parsed) return error('无效的飞书文档 URL');
    const result = await updateBlock(parsed, block_id, content);
    return success(result);
  } catch (err) {
    return error(err.message);
  }
}
