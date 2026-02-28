/**
 * 工具: feishu_wiki_list_spaces - 列出知识库空间
 */
import { success, error } from '../utils/helpers.js';
import { listWikiSpaces } from '../services/drive.js';

export const name = 'feishu_wiki_list_spaces';

export const description = '列出飞书知识库（Wiki）空间列表。返回空间 ID 和名称，用于浏览知识库目录。';

export const inputSchema = {
  type: 'object',
  properties: {
    page_token: {
      type: 'string',
      description: '分页 token（可选）'
    }
  }
};

export async function handler({ page_token }) {
  try {
    const result = await listWikiSpaces(page_token);
    return success(result);
  } catch (err) {
    return error(err.message);
  }
}
