/**
 * 工具: feishu_doc_create - 创建新文档
 */
import { success, error } from '../utils/helpers.js';
import { createDocument } from '../services/document.js';

export const name = 'feishu_doc_create';

export const description = '创建新的飞书文档。支持指定标题、初始内容和目标文件夹。返回新文档的 URL。';

export const inputSchema = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: '文档标题'
    },
    markdown: {
      type: 'string',
      description: '文档初始内容（可选）'
    },
    folder_token: {
      type: 'string',
      description: '目标文件夹 token（可选，不填则创建在根目录）'
    }
  },
  required: ['title']
};

export async function handler({ title, markdown, folder_token }) {
  try {
    const result = await createDocument(title, markdown, folder_token);
    return success(result);
  } catch (err) {
    return error(err.message);
  }
}
