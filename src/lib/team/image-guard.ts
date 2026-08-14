// 团队出图护栏注册表(平台通用):每次团队运行发一个 run token,配额计数和真实产出路径都记在这里。
// 使用方:etsy-forge 出图团队、聊天团队会话。
//
// 为什么在服务端管而不是 SDK 会话里管:canUseTool / PostToolUse hook / 进程内 MCP server
// 都骑在 SDK↔CLI 控制协议上,复杂多子代理会话里该往返会断(实测 "Tool permission request
// failed: Stream closed",bypass 后处理器也从未被调用)。出图改走 stdio MCP → HTTP 回调,
// 护栏随之落在 HTTP 层——与控制协议彻底无关,并行多少个成员都不受影响。

import crypto from 'node:crypto';

export interface TeamImageGuard {
  billingUserId: string;
  cap: number;
  used: number;
  producedPaths: Set<string>;
  onQuotaDenied?: (used: number, cap: number) => void;
  createdAt: number;
  /**
   * 团队级图片服务商(按调用者分流):整队出图统一走它,空=全局默认。
   * 只做到团队级——出图 HTTP 回调只有 runToken、拿不到"当前是哪个成员",
   * 成员级细分(同队不同成员各自不同)需要另做,见 T3.2 第二批。
   * 有 teamId 时此值仅作团队记录已删的兜底:回调按 teamId 现解析团队默认,
   * 用户轮次中途在界面改团队服务商即时生效(#65)。
   */
  imageProviderId?: string;
  /** 来源团队 id:出图回调据此现解析团队默认服务商(见 imageProviderId 注释) */
  teamId?: string;
}

// 注册表挂 globalThis:Next dev 热重载会产生多份模块实例,团队会话和 API route 必须
// 看到同一张表(与 image registry 的教训同源——状态单例要抗模块重载)。
const REGISTRY_KEY = Symbol.for('lumos.team-image-guards');
type Registry = Map<string, TeamImageGuard>;
const globalStore = globalThis as { [REGISTRY_KEY]?: Registry };
const guards: Registry = globalStore[REGISTRY_KEY] ?? new Map();
globalStore[REGISTRY_KEY] = guards;

// 兜底回收:团队会话硬超时 30min,45min 后仍在表里的一定是泄漏(进程没崩的前提下
// finally 会释放;这里防的是极端路径)。在创建时顺手清扫,不开定时器。
const GUARD_MAX_AGE_MS = 45 * 60 * 1000;

export function createTeamImageGuard(input: {
  billingUserId: string;
  cap: number;
  onQuotaDenied?: (used: number, cap: number) => void;
  imageProviderId?: string;
  teamId?: string;
}): string {
  const now = Date.now();
  for (const [token, guard] of guards) {
    if (now - guard.createdAt > GUARD_MAX_AGE_MS) guards.delete(token);
  }
  const token = crypto.randomUUID();
  guards.set(token, {
    billingUserId: input.billingUserId,
    cap: input.cap,
    used: 0,
    producedPaths: new Set(),
    onQuotaDenied: input.onQuotaDenied,
    createdAt: now,
    ...(input.imageProviderId ? { imageProviderId: input.imageProviderId } : {}),
    ...(input.teamId ? { teamId: input.teamId } : {}),
  });
  return token;
}

export function getTeamImageGuard(token: string): TeamImageGuard | undefined {
  return guards.get(token);
}

export function releaseTeamImageGuard(token: string): void {
  guards.delete(token);
}
