'use client';

import * as React from 'react';
import { Loader2, ChevronDown, ChevronRight, Trash2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { SettingsExcludedDialog } from './SettingsExcludedDialog';
import { SettingsGroupTagMemberPicker } from './SettingsGroupTagMemberPicker';
import type { GroupTag, GroupTagRule } from './app-settings';

type ResolvedView = {
  groupWxids: string[];
  groups: { wxid: string; name: string; via: 'member' | 'manual'; matchedMembers?: string[] }[];
  resolvedAt: string;
  warning?: string;
};

function emptyTag(): GroupTag {
  return {
    id: (globalThis.crypto?.randomUUID?.() ?? `tag_${Date.now()}`),
    name: '',
    rule: { kind: 'member_in_group', members: [], matchMode: 'any', groups: [], excludeGroups: [] },
    resolved: null,
  };
}

function ruleSummary(rule: GroupTagRule): string {
  const parts: string[] = [];
  if (rule.kind === 'member_in_group') parts.push(`成员 ${rule.members.length} 人所在群`);
  if (rule.groups.length) parts.push(`手选 ${rule.groups.length} 群`);
  if (rule.excludeGroups.length) parts.push(`排除 ${rule.excludeGroups.length}`);
  return parts.join(' · ') || '未配置规则';
}

export function SettingsGroupTags({
  tags,
  onChange,
}: {
  tags: GroupTag[];
  onChange: (next: GroupTag[]) => void;
}): React.ReactElement {
  const [draft, setDraft] = React.useState<GroupTag | null>(null);
  const [picker, setPicker] = React.useState<'groups' | 'exclude' | null>(null);
  const [memberLabels, setMemberLabels] = React.useState<Record<string, string>>({});
  const [previewing, setPreviewing] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [resolved, setResolved] = React.useState<Record<string, ResolvedView>>({});
  const [err, setErr] = React.useState<string | null>(null);

  const isEditing = (id: string) => draft?.id === id;

  async function runPreview(tag: GroupTag, persist: boolean): Promise<void> {
    setPreviewing(tag.id);
    setErr(null);
    try {
      const res = await fetch('/api/apps/builtin/wechat/group-tags/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tag }),
      });
      const json = (await res.json().catch(() => ({}))) as { resolved?: ResolvedView; message?: string; error?: string };
      if (!res.ok || !json.resolved) throw new Error(json.message ?? json.error ?? '解析失败');
      setResolved((prev) => ({ ...prev, [tag.id]: json.resolved! }));
      setExpanded(tag.id);
      if (persist) {
        onChange(
          tags.map((t) =>
            t.id === tag.id
              ? {
                  ...t,
                  resolved: {
                    groupWxids: json.resolved!.groupWxids,
                    resolvedAt: json.resolved!.resolvedAt,
                    sourceMtime: Date.now(),
                  },
                }
              : t,
          ),
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : '解析失败');
    } finally {
      setPreviewing(null);
    }
  }

  function saveDraft(): void {
    const name = draft?.name.trim();
    if (!draft || !name) {
      setErr('标签名不能为空');
      return;
    }
    // AI 按名字定位标签，重名会选错 → 存盘前强制唯一（忽略大小写，排除自身）。
    if (tags.some((t) => t.id !== draft.id && t.name.trim().toLowerCase() === name.toLowerCase())) {
      setErr(`已存在同名标签「${name}」，请改个名字`);
      return;
    }
    const r = draft.rule;
    const hasInput =
      (r.kind === 'member_in_group' && r.members.length > 0) || r.groups.length > 0;
    if (!hasInput) {
      setErr(r.kind === 'member_in_group'
        ? '规则未配置：请至少选一个成员，或手选群'
        : '规则未配置：请至少手选一个群');
      return;
    }
    // 规则可能已改，旧 resolved 缓存计数会误导 → 存盘即清空，下次预览/总结重算。
    const saved: GroupTag = { ...draft, name, resolved: null };
    const exists = tags.some((t) => t.id === saved.id);
    onChange(exists ? tags.map((t) => (t.id === saved.id ? saved : t)) : [...tags, saved]);
    setDraft(null);
    setErr(null);
    // 存盘即自动预览：立刻让用户看到"= N 群"，兑现"规则可见即可核对"的设计。
    void runPreview(saved, false);
  }

  return (
    <div className="space-y-3">
      {err ? <p className="text-xs text-red-500">{err}</p> : null}

      {tags.length === 0 && !draft ? (
        <p className="text-xs text-muted-foreground">
          还没有群标签。新建一个，如「工作群 = 刘总所在的群」，之后可让 AI「总结工作群」。
        </p>
      ) : null}

      <ul className="divide-y rounded-md border">
        {tags.map((tag) => {
          const rv = resolved[tag.id];
          const cachedCount = tag.resolved?.groupWxids.length ?? null;
          return (
            <li key={tag.id} className="px-3 py-2 text-sm">
              {isEditing(tag.id) ? (
                <TagEditor
                  draft={draft!}
                  setDraft={setDraft as (t: GroupTag) => void}
                  onPick={setPicker}
                  onSave={saveDraft}
                  onCancel={() => { setDraft(null); setErr(null); }}
                  memberLabels={memberLabels}
                  setMemberLabels={setMemberLabels}
                />
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-medium">{tag.name || '(未命名)'}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{ruleSummary(tag.rule)}</span>
                      {cachedCount !== null ? (
                        <span className="ml-2 text-xs text-muted-foreground tabular-nums">· 缓存 {cachedCount} 群</span>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="sm" disabled={previewing === tag.id}
                        onClick={() => void runPreview(tag, true)}>
                        {previewing === tag.id
                          ? <Loader2 className="size-3.5 animate-spin" />
                          : <RefreshCw className="size-3.5" />}
                        <span className="ml-1 text-xs">重新计算</span>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDraft({ ...tag, rule: { ...tag.rule } })}>
                        <span className="text-xs">编辑</span>
                      </Button>
                      <Button variant="ghost" size="sm"
                        onClick={() => onChange(tags.filter((t) => t.id !== tag.id))}>
                        <Trash2 className="size-3.5 text-red-500" />
                      </Button>
                    </div>
                  </div>
                  {rv ? (
                    <div className="text-xs">
                      <button type="button" className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                        onClick={() => setExpanded(expanded === tag.id ? null : tag.id)}>
                        {expanded === tag.id ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                        当前匹配 {rv.groupWxids.length} 群{rv.warning ? ` · ⚠ ${rv.warning}` : ''}
                      </button>
                      {expanded === tag.id ? (
                        <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto rounded border bg-muted/20 p-2">
                          {rv.groups.map((g) => (
                            <li key={g.wxid} className="flex items-center justify-between gap-2">
                              <span className="truncate">{g.name}</span>
                              <span className="shrink-0 text-[10px] text-muted-foreground">
                                {g.via === 'member' ? `成员命中 ${g.matchedMembers?.length ?? 0}` : '手选'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
        {draft && !tags.some((t) => t.id === draft.id) ? (
          <li className="px-3 py-2">
            <TagEditor
              draft={draft}
              setDraft={setDraft as (t: GroupTag) => void}
              onPick={setPicker}
              onSave={saveDraft}
              onCancel={() => { setDraft(null); setErr(null); }}
              memberLabels={memberLabels}
              setMemberLabels={setMemberLabels}
            />
          </li>
        ) : null}
      </ul>

      {!draft ? (
        <Button variant="outline" size="sm" onClick={() => setDraft(emptyTag())}>
          + 新建标签
        </Button>
      ) : null}

      {/* 手选群 / 排除群仍用既有会话多选弹窗；成员改用全量通讯录搜索
          （见 TagEditor 内联 MemberPicker），避免没直聊的人选不到。 */}
      <SettingsExcludedDialog
        open={picker === 'groups'}
        selectedIds={draft?.rule.groups ?? []}
        onOpenChange={(o) => !o && setPicker(null)}
        onConfirm={(ids) => {
          if (draft) setDraft({ ...draft, rule: { ...draft.rule, groups: ids } });
          setPicker(null);
        }}
        title="手动选择要纳入的群"
        description="规则覆盖不到时手动补；与成员规则结果取并集。"
        confirmLabel="确定（已选 {count}）"
      />
      <SettingsExcludedDialog
        open={picker === 'exclude'}
        selectedIds={draft?.rule.excludeGroups ?? []}
        onOpenChange={(o) => !o && setPicker(null)}
        onConfirm={(ids) => {
          if (draft) setDraft({ ...draft, rule: { ...draft.rule, excludeGroups: ids } });
          setPicker(null);
        }}
        title="选择要排除的群"
        description="从最终结果里剔除（如刘总在的家庭群）。"
        confirmLabel="确定（已选 {count}）"
      />
    </div>
  );
}

function TagEditor({
  draft,
  setDraft,
  onPick,
  onSave,
  onCancel,
  memberLabels,
  setMemberLabels,
}: {
  draft: GroupTag;
  setDraft: (t: GroupTag) => void;
  onPick: (p: 'groups' | 'exclude') => void;
  onSave: () => void;
  onCancel: () => void;
  memberLabels: Record<string, string>;
  setMemberLabels: (m: Record<string, string>) => void;
}): React.ReactElement {
  return (
    <div className="space-y-2">
      <Input
        value={draft.name}
        placeholder="标签名，如 工作群"
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        className="h-8 text-sm"
      />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={draft.rule.kind === 'member_in_group'}
            onChange={() => setDraft({ ...draft, rule: { ...draft.rule, kind: 'member_in_group' } })}
          />
          成员所在群
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={draft.rule.kind === 'manual'}
            onChange={() => setDraft({ ...draft, rule: { ...draft.rule, kind: 'manual' } })}
          />
          仅手选群
        </label>
      </div>
      {draft.rule.kind === 'member_in_group' ? (
        <SettingsGroupTagMemberPicker
          selected={draft.rule.members}
          labels={memberLabels}
          onChange={(members, labels) => {
            setMemberLabels(labels);
            setDraft({ ...draft, rule: { ...draft.rule, members } });
          }}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => onPick('groups')}>
          手选群（{draft.rule.groups.length}）
        </Button>
        <Button variant="outline" size="sm" onClick={() => onPick('exclude')}>
          排除群（{draft.rule.excludeGroups.length}）
        </Button>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onSave}>保存</Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}
