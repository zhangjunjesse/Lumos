/**
 * 群标签解析：把 settings 里的标签规则解析成一组群 wxid。
 *
 * 设计取舍：**每次实时解析**（exporter 查 contact.db ~百毫秒），不在 TS 侧
 * 再加 mtime 缓存——本会话已多次踩"写一次永不失效"的坑；exporter 自身的
 * contacts/name2id 新鲜度本会话已修。`tag.resolved` 只作 UI 展示/持久快照，
 * 由调用方（设置保存 / preview / 总结前）按需写回，不在此处缓存。
 *
 * 最终群集 = (member_in_group 解析 ∪ manual.groups) − excludeGroups。
 */
import type { GroupTag } from '@/components/apps/builtin/wechat/app-settings';
import { queryWeChatApi } from '@/lib/wechat-export/api-bridge';

export interface ResolvedGroup {
  wxid: string;
  name: string;
  via: 'member' | 'manual';
  /** member 规则下命中的成员 wxid（证据，给 UI"展开核对"用）。 */
  matchedMembers?: string[];
}

export interface ResolvedGroupTag {
  tagId: string;
  tagName: string;
  groupWxids: string[];
  groups: ResolvedGroup[];
  resolvedAt: string;
  /** 非空 = 成员解析有问题（如 contact.db 不可读）；调用方如实呈现，不静默。 */
  warning?: string;
}

interface GroupsWithMemberResponse {
  groups?: { wxid: string; name?: string; matched_members?: string[] }[];
  total?: number;
  warning?: string;
}

export async function resolveGroupTag(tag: GroupTag): Promise<ResolvedGroupTag> {
  const rule = tag.rule;
  const byWxid = new Map<string, ResolvedGroup>();
  let warning: string | undefined;

  if (rule.kind === 'member_in_group' && rule.members.length > 0) {
    const res = await queryWeChatApi<GroupsWithMemberResponse>(
      'list_groups_with_member',
      { member_wxids: rule.members, match_mode: rule.matchMode },
    );
    if (res.ok) {
      if (res.data.warning) warning = res.data.warning;
      for (const g of res.data.groups ?? []) {
        if (!g.wxid) continue;
        byWxid.set(g.wxid, {
          wxid: g.wxid,
          name: g.name || g.wxid,
          via: 'member',
          matchedMembers: g.matched_members ?? [],
        });
      }
    } else {
      warning = `成员群解析失败：${res.error.message}`;
    }
  }

  // manual 群补集（member 已命中的不覆盖，保留其证据/名字）。
  for (const wxid of rule.groups) {
    if (wxid && !byWxid.has(wxid)) {
      byWxid.set(wxid, { wxid, name: wxid, via: 'manual' });
    }
  }

  const exclude = new Set(rule.excludeGroups);
  const groups = [...byWxid.values()]
    .filter((g) => !exclude.has(g.wxid))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'));

  return {
    tagId: tag.id,
    tagName: tag.name,
    groupWxids: groups.map((g) => g.wxid),
    groups,
    resolvedAt: new Date().toISOString(),
    warning,
  };
}

/** 按 id 或名字（精确，再大小写不敏感）从标签列表里找一个标签。 */
export function findGroupTag(tags: GroupTag[], ref: string): GroupTag | null {
  const r = ref.trim();
  if (!r) return null;
  return (
    tags.find((t) => t.id === r) ??
    tags.find((t) => t.name === r) ??
    tags.find((t) => t.name.toLowerCase() === r.toLowerCase()) ??
    null
  );
}
