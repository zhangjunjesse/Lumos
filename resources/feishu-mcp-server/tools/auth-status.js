/**
 * 工具: feishu_auth_status - 检查认证状态
 */
import { success, error } from '../utils/helpers.js';
import { getAuthStatus } from '../services/auth.js';

export const name = 'feishu_auth_status';

export const description = '检查飞书 API 认证状态。返回当前 token 是否有效。';

export const inputSchema = {
  type: 'object',
  properties: {}
};

export async function handler() {
  try {
    const result = await getAuthStatus();
    return success(result);
  } catch (err) {
    return error(err.message);
  }
}
