/**
 * 工具: feishu_image_download - 下载文档图片
 */
import { success, error } from '../utils/helpers.js';
import { downloadImage } from '../services/image.js';

export const name = 'feishu_image_download';

export const description = '下载飞书文档中的图片并返回 base64 数据。可用于图片识别、分析等场景。';

export const inputSchema = {
  type: 'object',
  properties: {
    image_token: {
      type: 'string',
      description: '图片 token，通过 feishu_image_list 或 feishu_doc_read 的 imageMap 获取'
    }
  },
  required: ['image_token']
};

export async function handler({ image_token }) {
  try {
    const result = await downloadImage(image_token);
    return success(result);
  } catch (err) {
    return error(err.message);
  }
}
