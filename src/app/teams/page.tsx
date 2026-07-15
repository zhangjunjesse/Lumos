'use client';

// 团队管理页:左列团队列表,右侧编辑(SOP/成员编排/模型)。
// 成员本体在「成员」页维护;这里只做组队和启停。设计:docs/chat-team-design.md §4.2。

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { TeamEditor } from '@/components/teams/TeamEditor';
import type { TeamView } from '@/components/teams/team-types';

export default function TeamsPage() {
  const [teams, setTeams] = useState<TeamView[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch('/api/teams');
    const d = (await res.json()) as { teams?: TeamView[] };
    const list = d.teams || [];
    setTeams(list);
    setSelectedId((prev) => (list.some((t) => t.id === prev) ? prev : list[0]?.id ?? ''));
    setLoading(false);
  }, []);

  /* eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time list load, setState only after fetch resolves */
  useEffect(() => { void load(); }, [load]);

  const handleCreate = async () => {
    const res = await fetch('/api/teams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `团队 ${teams.length + 1}` }),
    });
    const d = (await res.json()) as { team?: { id: string } };
    await load();
    if (d.team?.id) setSelectedId(d.team.id);
  };

  const selected = teams.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="flex h-full">
      <aside className="w-60 shrink-0 border-r border-border/50 p-4 space-y-3 overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">团队</h2>
          <Button size="sm" variant="outline" onClick={handleCreate}>新建</Button>
        </div>
        <div className="space-y-1">
          {teams.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                t.id === selectedId ? 'bg-accent font-medium' : 'hover:bg-accent/50'
              }`}
            >
              <span className="block truncate">{t.name}{t.isDefault && <span className="ml-1.5 text-[10px] text-primary">默认</span>}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {t.memberRefs.length} 名成员{t.description ? ` · ${t.description}` : ''}
              </span>
            </button>
          ))}
          {!loading && teams.length === 0 && (
            <p className="px-1 py-6 text-xs text-muted-foreground">
              还没有团队。新建一个,写好 SOP、从成员库挑人,然后在聊天里选它开工。
            </p>
          )}
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        {selected ? (
          <TeamEditor team={selected} onChanged={load} onDeleted={load} />
        ) : loading ? (
          <p className="text-sm text-muted-foreground">加载中…</p>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center space-y-2">
              <p className="text-sm font-medium">用团队来干活</p>
              <p className="text-xs text-muted-foreground max-w-sm">
                团队 = 一份 SOP(队长工作手册)+ 一组成员。聊天时选中团队,队长会按 SOP 把任务派给成员协作完成。
              </p>
              <Button size="sm" onClick={handleCreate}>新建团队</Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
