// 内置出图团队汇总。顺序即列表展示顺序;首个(默认团队)带 isDefault。
// seeding: team-store.ensureBuiltinTeams 按名字 create-if-missing——只补用户没有的,
// 绝不覆盖用户已改/已建的同名团队。

import { DEFAULT_TEAM, DEFAULT_TEAM_NAME } from './default-team-def';
import { BAOKUAN_TEAM } from './baokuan';
import { ORIGINAL_TEAM } from './original';
import { TYPOGRAPHY_TEAM } from './typography';
import { NICHE_TEAM } from './niche';
import type { BuiltinTeamDef } from './types';

export type { BuiltinTeamDef } from './types';
export { DEFAULT_TEAM_NAME };

export const BUILTIN_TEAMS: BuiltinTeamDef[] = [
  DEFAULT_TEAM,
  BAOKUAN_TEAM,
  ORIGINAL_TEAM,
  TYPOGRAPHY_TEAM,
  NICHE_TEAM,
];
