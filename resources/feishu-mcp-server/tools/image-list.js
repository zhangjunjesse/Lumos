/**
 * 工具: feishu_image_list - 获取文档图片列表
 */
import { parseFeishuUrl, success, error } from '../utils/helpers.js';
import { getImageList } from '../services/image.js';

export const name = 'feishu_image_list';

export const description = '获取飞书文档中的所有图片列表，返回每张图片的 token 和尺寸。配合 feishu_image_download 使用。';

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
    const result = await getImageList(parsed);
    return success(result);
  } catch (err) {
    return error(err.message);
  }
}
