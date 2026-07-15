'use client';

// 新会话的团队选择条:不选=普通聊天;选中=会话级绑定,整个会话由该团队执行。

import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface TeamOption { id: string; name: string; memberCount: number }

export function TeamChatPicker({ value, onChange }: {
  value: string;
  onChange: (teamId: string, teamName: string) => void;
}) {
  const [teams, setTeams] = useState<TeamOption[]>([]);

  useEffect(() => {
    fetch('/api/teams')
      .then((r) => r.json())
      .then((d: { teams?: Array<{ id: string; name: string; memberRefs: unknown[] }> }) => {
        setTeams((d.teams || []).map((t) => ({ id: t.id, name: t.name, memberCount: t.memberRefs.length })));
      })
      .catch(() => setTeams([]));
  }, []);

  if (teams.length === 0) return null; // 没建过团队就不打扰

  return (
    <div className="mx-auto flex w-full max-w-3xl items-center justify-end gap-2 px-4 pb-1">
      <span className="text-xs text-muted-foreground">用团队开聊</span>
      <Select
        value={value || '__solo__'}
        onValueChange={(v) => {
          if (v === '__solo__') onChange('', '');
          else onChange(v, teams.find((t) => t.id === v)?.name || '');
        }}
      >
        <SelectTrigger className="h-7 w-44 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__solo__">不用团队(普通对话)</SelectItem>
          {teams.map((t) => (
            <SelectItem key={t.id} value={t.id}>{t.name}({t.memberCount}人)</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
