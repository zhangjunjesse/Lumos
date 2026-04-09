/**
 * Admin-level operations against the new-api backend.
 *
 * Used during registration to create user tokens and during top-up to
 * adjust quotas. Requires NEW_API_ADMIN_TOKEN in the environment.
 */

const DEFAULT_BASE = 'http://api.miki.zj.cn';

interface NewApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
}

interface TokenData {
  id: number;
  key: string;
  name: string;
  remain_quota: number;
  used_quota: number;
  status: number;
}

function getBase(): string {
  return process.env.NEW_API_BASE || DEFAULT_BASE;
}

function getAdminToken(): string {
  const token = process.env.NEW_API_ADMIN_TOKEN;
  if (!token) {
    throw new Error('NEW_API_ADMIN_TOKEN 环境变量未配置');
  }
  return token;
}

async function adminRequest<T>(
  path: string,
  options?: RequestInit,
): Promise<NewApiResponse<T>> {
  const res = await fetch(`${getBase()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAdminToken()}`,
      ...(options?.headers as Record<string, string>),
    },
  });

  if (!res.ok) {
    throw new Error(`new-api 请求失败: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<NewApiResponse<T>>;
}

/**
 * Create a new API token for a user with the specified initial quota.
 */
export async function createNewApiToken(
  name: string,
  quota: number,
): Promise<{ tokenId: number; tokenKey: string }> {
  const res = await adminRequest<TokenData>('/api/token/', {
    method: 'POST',
    body: JSON.stringify({
      name,
      remain_quota: quota,
      unlimited_quota: false,
    }),
  });

  if (!res.success || !res.data) {
    throw new Error(res.message || '创建 new-api token 失败');
  }

  return { tokenId: res.data.id, tokenKey: res.data.key };
}

/**
 * Add quota to an existing token.
 * Reads current remain_quota then updates with the added amount.
 */
export async function addTokenQuota(
  tokenId: number,
  addQuota: number,
): Promise<void> {
  const current = await getTokenQuota(tokenId);

  const res = await adminRequest<TokenData>('/api/token/', {
    method: 'PUT',
    body: JSON.stringify({
      id: tokenId,
      remain_quota: current.remainQuota + addQuota,
    }),
  });

  if (!res.success) {
    throw new Error(res.message || '更新 token 额度失败');
  }
}

/**
 * Query the current quota usage of a token.
 */
export async function getTokenQuota(
  tokenId: number,
): Promise<{ remainQuota: number; usedQuota: number }> {
  const res = await adminRequest<TokenData>(`/api/token/${tokenId}`, {
    method: 'GET',
  });

  if (!res.success || !res.data) {
    throw new Error(res.message || '查询 token 额度失败');
  }

  return {
    remainQuota: res.data.remain_quota,
    usedQuota: res.data.used_quota,
  };
}
