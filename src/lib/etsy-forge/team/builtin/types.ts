// 内置出图团队定义。每个内置团队一个文件(人设很长,拆开各自 <300 行),
// 汇总在 index.ts 的 BUILTIN_TEAMS;seeding 见 team-store.ensureBuiltinTeams。

import type { TeamMember } from '../../types';

export interface BuiltinTeamDef {
  name: string;
  description: string;
  sop: string; // 队长工作手册,{N} 运行时替换成目标出图张数
  members: TeamMember[];
  imagesPerRun: number;
  isDefault?: boolean; // 首个内置团队;seed 时若用户尚无默认团队则设为默认
}
