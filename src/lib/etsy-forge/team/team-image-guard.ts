// 团队出图护栏注册表:每次团队运行发一个 run token,配额计数和真实产出路径都记在这里。
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
}

// 注册表挂 globalThis:Next dev 热重载会产生多份模块实例,团队会话和 API route 必须
// 看到同一张表(与 image registry 的教训同源——状态单例要抗模块重载)。
const REGISTRY_KEY = Symbol.for('lumos.etsy-forge.team-image-guards');
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
  });
  return token;
}

export function getTeamImageGuard(token: string): TeamImageGuard | undefined {
  return guards.get(token);
}

export function releaseTeamImageGuard(token: string): void {
  guards.delete(token);
}
