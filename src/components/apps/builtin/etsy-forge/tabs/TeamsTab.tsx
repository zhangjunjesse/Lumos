'use client';

// 出图团队 tab —— 一键出品第⑦步的「团队出图」由这里配置的团队完成。
// 左列团队列表(选中)+ 右侧详情(名称/描述/每商品张数/成员)。改动整份 members 走 PATCH 存。
// 职能:设计成员才调图片生成;策划出创作指令;审核负责质检评级。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { etsyForgeApi, type AgentTeam, type TeamMember } from '../api-client';
import { TeamMemberEditor } from './TeamMemberEditor';
import { MockupTemplatesSection } from './MockupTemplatesSection';

const newMember = (): TeamMember => ({
  id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
  name: '新成员',
  role: 'designer',
  prompt: '',
  enabled: true,
});

export function TeamsTab() {
  const [teams, setTeams] = useState<AgentTeam[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (keepId?: string) => {
    setError(null);
    try {
      const { teams: rows } = await etsyForgeApi.listTeams();
      setTeams(rows);
      setSelectedId((cur) => keepId ?? cur ?? rows.find((t) => t.is_default)?.id ?? rows[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(() => teams.find((t) => t.id === selectedId) ?? null, [teams, selectedId]);

  // 本地改选中团队字段(乐观),供输入即时反馈;保存走下面 save*。
  const patchLocal = (patch: Partial<AgentTeam>) =>
    setTeams((rows) => rows.map((t) => (t.id === selectedId ? { ...t, ...patch } : t)));

  const saveTeam = async (patch: Partial<Pick<AgentTeam, 'name' | 'description' | 'members' | 'images_per_run'>>) => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await etsyForgeApi.updateTeam(selected.id, patch);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await load(selected.id);
    } finally {
      setSaving(false);
    }
  };

  // 成员数组任何变更都整份回传(PATCH members)。
  const commitMembers = (members: TeamMember[]) => {
    patchLocal({ members });
    void saveTeam({ members });
  };
  const changeMember = (idx: number, next: TeamMember) => {
    if (!selected) return;
    commitMembers(selected.members.map((m, i) => (i === idx ? next : m)));
  };
  const removeMember = (idx: number) => {
    if (!selected) return;
    commitMembers(selected.members.filter((_, i) => i !== idx));
  };
  const addMember = () => {
    if (!selected) return;
    commitMembers([...selected.members, newMember()]);
  };

  const createTeam = async () => {
    setError(null);
    try {
      const { team } = await etsyForgeApi.createTeam({ name: `团队 ${teams.length + 1}` });
      await load(team.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const setDefault = async () => {
    if (!selected || selected.is_default) return;
    try {
      await etsyForgeApi.updateTeam(selected.id, { is_default: true });
      await load(selected.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const deleteTeam = async () => {
    if (!selected) return;
    if (!confirm(`删除团队「${selected.name}」？一键出品将不再可选它。`)) return;
    try {
      await etsyForgeApi.deleteTeam(selected.id);
      setSelectedId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex gap-5">
      <aside className="w-64 shrink-0 space-y-2">
        <Button size="sm" className="w-full" onClick={() => void createTeam()}>
          ＋ 新建团队
        </Button>
        {error && <p className="rounded bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
        {loading ? (
          <p className="px-1 text-xs text-muted-foreground">加载中…</p>
        ) : (
          teams.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedId(t.id)}
              className={`w-full rounded-lg border p-3 text-left ${
                t.id === selectedId ? 'border-foreground bg-card ring-1 ring-foreground' : 'bg-card hover:bg-muted'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">{t.name}</span>
                {t.is_default && <span className="shrink-0 rounded bg-foreground px-1 text-[9px] text-background">默认</span>}
              </div>
              {t.description && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{t.description}</p>}
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t.members.filter((m) => m.enabled).length}/{t.members.length} 名成员 · 每商品 {t.images_per_run ?? 5} 张
              </p>
            </button>
          ))
        )}
      </aside>

      <section className="min-w-0 flex-1">
        {!selected ? (
          <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">
            {loading ? '加载中…' : '左侧选一个团队,或「新建团队」。'}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border bg-card p-5">
              <div className="flex items-start gap-2">
                <div className="flex-1 space-y-2">
                  <input
                    value={selected.name}
                    onChange={(e) => patchLocal({ name: e.target.value })}
                    onBlur={(e) => void saveTeam({ name: e.target.value.trim() || '未命名团队' })}
                    placeholder="团队名"
                    className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm font-medium"
                  />
                  <input
                    value={selected.description ?? ''}
                    onChange={(e) => patchLocal({ description: e.target.value })}
                    onBlur={(e) => void saveTeam({ description: e.target.value })}
                    placeholder="一句话描述(给你自己看的)"
                    className="w-full rounded border border-input bg-background px-2 py-1.5 text-xs text-muted-foreground"
                  />
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">{saving ? '保存中…' : '改完自动保存'}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <label className="flex items-center gap-1.5 text-muted-foreground">
                  每商品出图张数
                  <select
                    value={selected.images_per_run ?? 5}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      patchLocal({ images_per_run: n });
                      void saveTeam({ images_per_run: n });
                    }}
                    className="h-8 rounded-md border border-input bg-background px-2 focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex-1" />
                <Button size="sm" variant="outline" disabled={selected.is_default} onClick={() => void setDefault()}>
                  {selected.is_default ? '默认团队' : '设为默认'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={() => void deleteTeam()}
                >
                  删除团队
                </Button>
              </div>
            </div>

            <div className="rounded-lg border bg-card p-5">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-sm font-medium">成员</h2>
                <Button size="sm" variant="outline" onClick={addMember}>
                  ＋ 添加成员
                </Button>
              </div>
              <p className="mb-3 text-[11px] text-muted-foreground">
                设计成员才能调图片生成;策划负责创作指令;审核负责质检评级。停用的成员不参与出图。
              </p>
              {selected.members.length === 0 ? (
                <p className="rounded border border-dashed p-6 text-center text-xs text-muted-foreground">
                  还没有成员,「添加成员」建一个。
                </p>
              ) : (
                <div className="space-y-2">
                  {selected.members.map((m, idx) => (
                    <TeamMemberEditor
                      key={m.id}
                      member={m}
                      onChange={(next) => changeMember(idx, next)}
                      onRemove={() => removeMember(idx)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
      </div>

      <MockupTemplatesSection />
    </div>
  );
}
