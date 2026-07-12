'use client';

// 出图团队 单个成员行:启用开关 / 名字 / 职能描述 / 可出图开关 / 编辑人设(弹框大 textarea) / 删除。
// 成员没有固定工种:duty 给队长派单看,人设(prompt)给成员自己,canGenerateImages 是唯一花钱的出图权限。
// 改动都通过 onChange 回传整个 member,由 TeamsTab 汇总成 members 数组走 PATCH 存。

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { TeamMember } from '../api-client';

export function TeamMemberEditor({
  member,
  onChange,
  onRemove,
}: {
  member: TeamMember;
  onChange: (next: TeamMember) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(member.prompt);

  const openEdit = () => {
    setDraft(member.prompt);
    setEditing(true);
  };
  const saveDraft = () => {
    onChange({ ...member, prompt: draft });
    setEditing(false);
  };

  return (
    <div className={`flex items-center gap-2 rounded border p-2.5 text-xs ${member.enabled ? '' : 'opacity-50'}`}>
      <input
        type="checkbox"
        checked={member.enabled}
        onChange={(e) => onChange({ ...member, enabled: e.target.checked })}
        className="size-3.5 shrink-0 accent-foreground"
        title={member.enabled ? '启用中,点击停用' : '已停用,点击启用'}
      />
      <input
        value={member.name}
        onChange={(e) => onChange({ ...member, name: e.target.value })}
        placeholder="成员名"
        className="w-28 shrink-0 rounded border border-input bg-background px-1.5 py-1"
      />
      <input
        value={member.duty}
        onChange={(e) => onChange({ ...member, duty: e.target.value })}
        placeholder="他负责什么,队长按这个派活"
        className="min-w-0 flex-1 rounded border border-input bg-background px-1.5 py-1"
      />
      <label
        className="flex shrink-0 items-center gap-1 text-muted-foreground"
        title="出图权限:唯一花钱的工具"
      >
        <input
          type="checkbox"
          checked={member.canGenerateImages}
          onChange={(e) => onChange({ ...member, canGenerateImages: e.target.checked })}
          className="size-3.5 accent-foreground"
        />
        可出图
      </label>
      <button type="button" onClick={openEdit} className="shrink-0 text-sky-600 hover:underline">
        编辑人设{member.prompt.trim() ? '' : '（空）'}
      </button>
      <button type="button" onClick={onRemove} className="shrink-0 px-1 text-destructive hover:underline">
        删
      </button>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>编辑人设 · {member.name || '未命名成员'}</DialogTitle>
            <DialogDescription>
              这段人设/工作方式会注入该成员自己的角色提示词,决定它怎么想、怎么出图。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            placeholder="例如:你是资深 Etsy 视觉设计师,擅长把印花放到干净的产品图上,注重构图留白与光影一致……"
            className="resize-y font-mono text-[12px] leading-relaxed"
          />
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
              取消
            </Button>
            <Button size="sm" onClick={saveDraft}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
