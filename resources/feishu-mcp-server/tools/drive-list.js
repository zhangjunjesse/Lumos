/**
 * 工具: feishu_drive_list - 列出云盘文件
 */
import { success, error } from '../utils/helpers.js';
import { listFiles } from '../services/drive.js';

export const name = 'feishu_drive_list';

export const description = '列出飞书云盘中指定文件夹下的文件和文档。支持分页和排序。不传 folder_token 则列出根目录。';

export const inputSchema = {
  type: 'object',
  properties: {
    folder_token: {
      type: 'string',
      description: '文件夹 token（可选，不填则列出根目录）'
    },
    page_token: {
      type: 'string',
      description: '分页 token，用于获取下一页（可选）'
    },
    order_by: {
      type: 'string',
      enum: ['EditedTime', 'CreatedTime'],
      description: '排序字段（可选）'
    },
    direction: {
      type: 'string',
      enum: ['ASC', 'DESC'],
      default: 'DESC',
      description: '排序方向（可选）'
    }
  }
};

export async function handler({ folder_token, page_token, order_by, direction }) {
  try {
    const result = await listFiles(folder_token, page_token, order_by, direction);
    return success(result);
  } catch (err) {
    return error(err.message);
  }
}
