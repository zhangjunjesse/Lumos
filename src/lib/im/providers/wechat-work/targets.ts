/**
 * WeChat Work Provider — Target Directory (M5 placeholder)
 *
 * 文件保留以维持所有 provider 同名同义结构 (R3)。M5 capabilities.targetDirectory=false，
 * 不接通讯录拉取。要启用：
 *   1. 实现 listWechatWorkTargets / resolveWechatWorkTarget
 *      （走 GET /cgi-bin/user/list_id 和 /cgi-bin/department/simplelist）
 *   2. 在 adapter.ts implements IMTargetDirectory 并连接这两个函数
 *   3. 把 manifest.capabilities.targetDirectory 改为 true
 */

import type { IMTarget, ListTargetsOptions } from '../../core/types';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function listWechatWorkTargets(opts?: ListTargetsOptions): Promise<IMTarget[]> {
  return [];
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function resolveWechatWorkTarget(query: string): Promise<IMTarget | null> {
  return null;
}
