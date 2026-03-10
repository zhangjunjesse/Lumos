/**
 * 飞书 OAuth 认证工具模块
 * 封装 token 存储、飞书 API 调用等共享逻辑
 */

import fs from "fs";
import path from "path";
import os from "os";
import {
  getFeishuCredentials,
  getFeishuOAuthScopes,
  resolveFeishuRedirectUri,
} from "@/lib/feishu-config";

const FEISHU_BASE_URL = "https://open.feishu.cn/open-apis";

const dataDir = process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
const TOKEN_FILE = path.join(dataDir, "auth", "feishu.json");

export interface FeishuUserInfo {
  name: string;
  email?: string;
  avatar_url?: string;
  open_id?: string;
}

export interface FeishuTokenData {
  userAccessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
  userInfo: FeishuUserInfo;
}

function getConfig() {
  const { appId, appSecret } = getFeishuCredentials();
  if (!appId || !appSecret) {
    throw new Error("Missing Feishu app credentials");
  }
  return { appId, appSecret };
}

export function getRedirectUri(requestOrigin?: string) {
  return resolveFeishuRedirectUri(requestOrigin);
}

export function buildAuthUrl(requestOrigin?: string): string {
  const { appId } = getConfig();
  const scopes = getFeishuOAuthScopes();

  const params = new URLSearchParams({
    app_id: appId,
    redirect_uri: getRedirectUri(requestOrigin),
    scope: scopes,
    state: Date.now().toString(),
  });
  return `${FEISHU_BASE_URL}/authen/v1/authorize?${params}`;
}

/** 用授权码换取 user_access_token (v2 接口) */
export async function exchangeCodeForToken(
  code: string,
  requestOrigin?: string,
): Promise<FeishuTokenData> {
  const { appId, appSecret } = getConfig();
  const redirectUri = getRedirectUri(requestOrigin);

  const res = await fetch(`${FEISHU_BASE_URL}/authen/v2/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: appId,
      client_secret: appSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(data.msg || data.error_description || "获取token失败");
  }

  const userInfo = await fetchUserInfo(data.access_token);

  const tokenData: FeishuTokenData = {
    userAccessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
    refreshExpiresAt: Date.now() + (data.refresh_expires_in || 2592000) * 1000,
    userInfo,
  };

  saveToken(tokenData);
  return tokenData;
}

/** 获取飞书用户信息 */
async function fetchUserInfo(accessToken: string): Promise<FeishuUserInfo> {
  try {
    const res = await fetch(`${FEISHU_BASE_URL}/authen/v1/user_info`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    if (data.code === 0 && data.data) {
      return {
        name: data.data.name,
        email: data.data.email,
        avatar_url: data.data.avatar_url,
        open_id: data.data.open_id,
      };
    }
  } catch {
    // fall through
  }
  return { name: "已授权用户" };
}

/** 读取存储的 token */
export function loadToken(): FeishuTokenData | null {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
    }
  } catch {
    // invalid file
  }
  return null;
}

/** 保存 token 到文件 */
export function saveToken(data: FeishuTokenData): void {
  const dir = path.dirname(TOKEN_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
}

/** 删除 token 文件 */
export function clearToken(): void {
  if (fs.existsSync(TOKEN_FILE)) {
    fs.unlinkSync(TOKEN_FILE);
  }
}
