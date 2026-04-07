/**
 * 飞书认证服务
 * 优先使用 user_access_token，fallback 到 tenant_access_token
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.env.FEISHU_BASE_URL || 'https://open.feishu.cn/open-apis';
const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;

// user token 文件路径
const USER_TOKEN_PATH = process.env.FEISHU_TOKEN_PATH
  || path.resolve(__dirname, '../../Lumos/data/auth/feishu.json');

// 缓存 tenant_access_token
let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * 读取 user token 文件，返回解析后的对象或 null
 */
function readUserToken() {
  try {
    const raw = fs.readFileSync(USER_TOKEN_PATH, 'utf-8');
    const data = JSON.parse(raw);
    if (data.userAccessToken && data.expiresAt > Date.now()) {
      return data;
    }
  } catch {
    // 文件不存在或解析失败，忽略
  }
  return null;
}

/**
 * 获取当前登录用户信息（若存在）
 */
export function getActiveUserInfo() {
  const userToken = readUserToken();
  return userToken?.userInfo || null;
}

/**
 * 强制获取 user_access_token（用于“按登录用户权限”访问）
 * 无有效用户登录时抛错，不回退 tenant_access_token。
 */
export function requireUserAccessToken() {
  const userToken = readUserToken();
  if (!userToken) {
    throw new Error('需要先完成飞书用户登录，且 token 仍在有效期内');
  }
  return userToken.userAccessToken;
}

async function fetchTenantAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 5 * 60 * 1000) {
    return cachedToken;
  }

  if (!APP_ID || !APP_SECRET) {
    throw new Error('缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET 环境变量');
  }

  const res = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET })
  });

  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(data.msg || '获取 tenant_access_token 失败');
  }

  cachedToken = data.tenant_access_token;
  tokenExpiresAt = Date.now() + (data.expire || 7200) * 1000;
  return cachedToken;
}

/**
 * 强制获取 tenant_access_token（用于仅支持应用身份调用的 API）
 */
export async function getTenantAccessToken() {
  return fetchTenantAccessToken();
}

/**
 * 获取 access token
 * 优先使用 user_access_token，fallback 到 tenant_access_token
 * @returns {Promise<string>}
 */
export async function getToken() {
  // 优先尝试 user token（每次重新读取，因为可能被外部更新）
  const userToken = readUserToken();
  if (userToken) {
    return userToken.userAccessToken;
  }

  // fallback: tenant_access_token
  return fetchTenantAccessToken();
}

/**
 * 获取认证状态
 */
export async function getAuthStatus() {
  try {
    const userToken = readUserToken();
    if (userToken) {
      return {
        authorized: true,
        tokenType: 'user_access_token',
        userInfo: userToken.userInfo || null
      };
    }

    await getToken();
    return {
      authorized: true,
      tokenType: 'tenant_access_token',
      appId: APP_ID ? `${APP_ID.slice(0, 6)}...` : 'not set'
    };
  } catch (err) {
    return {
      authorized: false,
      error: err.message
    };
  }
}

export { BASE_URL };
