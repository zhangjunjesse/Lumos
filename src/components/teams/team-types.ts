// /teams 页面的前端类型(与 /api/teams 返回形状对应)。

export interface TeamMemberRefView {
  presetId: string;
  enabled: boolean;
}

export interface ResolvedMemberView {
  ref: TeamMemberRefView;
  preset: {
    id: string;
    name: string;
    position?: string;
    responsibility?: string;
    description?: string;
    avatarPath?: string;
    toolPermissions?: { read: boolean; write: boolean; exec: boolean };
  } | null;
}

export interface TeamView {
  id: string;
  name: string;
  description: string;
  sop: string;
  memberRefs: TeamMemberRefView[];
  providerId: string;
  model: string;
  /** 团队默认图片服务商;空=全局默认 */
  defaultImageProviderId: string;
  isDefault: boolean;
  updatedAt: string;
  members: ResolvedMemberView[];
}
