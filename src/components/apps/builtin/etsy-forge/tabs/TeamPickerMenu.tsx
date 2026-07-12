'use client';

// 一键出品「选出图团队」下拉(单选)。团队来自 DB(可在「出图团队」tab 增删改),默认选中 is_default。
// 自带 trigger 按钮 + 弹层 + 单选态;点「开始」回调选中团队的 id + 名字(给确认框显示)。

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { etsyForgeApi, type AgentTeam } from '../api-client';

export function TeamPickerMenu({
  triggerLabel,
  confirmLabel,
  disabled,
  busy,
  onConfirm,
}: {
  triggerLabel: string; // 触发按钮文案前缀,如「一键出品 3 个」
  confirmLabel: string; // 弹层主按钮文案,如「开始一键出品」
  disabled?: boolean;
  busy?: boolean;
  onConfirm: (teamId: string | undefined, teamName?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [teams, setTeams] = useState<AgentTeam[]>([]);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  // 拉团队,默认选中 is_default(没有则选第一个)。
  useEffect(() => {
    void etsyForgeApi
      .listTeams()
      .then((r) => {
        setTeams(r.teams);
        setPicked((r.teams.find((t) => t.is_default) ?? r.teams[0])?.id);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const pickedTeam = teams.find((t) => t.id === picked);
  const memberCount = (t: AgentTeam) => t.members.filter((m) => m.enabled).length;

  return (
    <div className="relative">
      <Button size="sm" title="选出图团队后一键出品" disabled={disabled || busy} onClick={() => setOpen((v) => !v)}>
        {busy ? '启动中…' : triggerLabel} ▾
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-64 rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
            <p className="mb-1.5 px-1 text-[11px] text-muted-foreground">选出图团队(单选;可在「出图团队」tab 增删改)</p>
            {loaded && teams.length === 0 && (
              <p className="px-1 py-1 text-[11px] text-muted-foreground">还没有团队,去「出图团队」tab 建一个。</p>
            )}
            {teams.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-muted">
                <input
                  type="radio"
                  name="etsy-forge-team"
                  checked={picked === t.id}
                  onChange={() => setPicked(t.id)}
                  className="mt-0.5 size-3.5 shrink-0 accent-foreground"
                />
                <span className="text-xs leading-tight">
                  {t.name}
                  {t.is_default && <span className="ml-1 rounded bg-foreground px-1 text-[9px] text-background">默认</span>}
                  <span className="ml-1 text-[10px] text-muted-foreground">{memberCount(t)} 名成员 · 每商品 {t.images_per_run ?? 5} 张</span>
                </span>
              </label>
            ))}
            <Button
              size="sm"
              className="mt-2 w-full"
              disabled={!pickedTeam}
              onClick={() => {
                onConfirm(picked, pickedTeam?.name);
                setOpen(false);
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
