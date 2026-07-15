'use client';

// 团队编辑器:名称/描述、SOP(队长工作手册)、成员编排(启停/移除,本体去成员页改)、
// 团队级模型。交互范式沿用 etsy 出图团队(已验证好用)。

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MemberPicker } from './MemberPicker';
import type { TeamView } from './team-types';

interface ModelOption { providerId: string; providerName: string; value: string; label: string }
interface ProviderOption { id: string; name: string }

export function TeamEditor({ team, onChanged, onDeleted }: {
  team: TeamView;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description);
  const [sop, setSop] = useState(team.sop);
  const [providerId, setProviderId] = useState(team.providerId);
  const [model, setModel] = useState(team.model);
  const [refs, setRefs] = useState(team.memberRefs);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    setName(team.name); setDescription(team.description); setSop(team.sop);
    setProviderId(team.providerId); setModel(team.model); setRefs(team.memberRefs);
  }, [team]);

  useEffect(() => {
    fetch('/api/providers/models').then((r) => r.json()).then((data) => {
      const ms: ModelOption[] = []; const ps: ProviderOption[] = [];
      for (const g of data.groups || []) {
        ps.push({ id: g.provider_id, name: g.provider_name });
        for (const m of g.models || []) ms.push({ providerId: g.provider_id, providerName: g.provider_name, value: m.value, label: m.label });
      }
      setModels(ms); setProviders(ps);
    }).catch(() => {});
  }, []);

  const patch = async (body: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/teams/${team.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        alert(d?.error || '保存失败');
        return;
      }
      await onChanged();
    } finally {
      setSaving(false);
    }
  };

  const saveBasics = () => patch({ name, description, sop, providerId, model });
  const saveRefs = (next: typeof refs) => { setRefs(next); void patch({ memberRefs: next }); };

  const memberOf = (presetId: string) => team.members.find((m) => m.ref.presetId === presetId)?.preset ?? null;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>团队名称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>描述</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="这个团队擅长做什么" />
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>团队 SOP(队长工作手册)</Label>
        <Textarea
          value={sop}
          onChange={(e) => setSop(e.target.value)}
          placeholder={'写给队长看的工作手册:分工、工序、派单顺序、质量标准、失败应对。\n队长会把任务用 Task 派给成员,按成员「职能」决定派给谁。'}
          className="min-h-[180px] font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">派单纪律(合批、如实交差)由引擎内置,SOP 专注写清分工与质量标准即可。</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>会话服务商</Label>
          <Select value={providerId || '__default__'} onValueChange={(v) => { setProviderId(v === '__default__' ? '' : v); setModel(''); }}>
            <SelectTrigger><SelectValue placeholder="全局默认" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__">跟随全局默认</SelectItem>
              {providers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>会话模型</Label>
          <Select value={model || '__default__'} onValueChange={(v) => setModel(v === '__default__' ? '' : v)} disabled={!providerId}>
            <SelectTrigger><SelectValue placeholder={providerId ? '该服务商默认' : '先选服务商'} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__">服务商默认模型</SelectItem>
              {models.filter((m) => m.providerId === providerId).map((m) => (
                <SelectItem key={`${m.providerId}/${m.value}`} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={saveBasics} disabled={saving || !name.trim()}>{saving ? '保存中…' : '保存'}</Button>
        {!team.isDefault && (
          <Button size="sm" variant="outline" onClick={() => patch({ isDefault: true })} disabled={saving}>设为默认</Button>
        )}
        <div className="flex-1" />
        <Button
          size="sm" variant="ghost" className="text-destructive hover:text-destructive"
          onClick={async () => {
            if (!confirm(`确认删除团队「${team.name}」？成员本体不受影响。`)) return;
            await fetch(`/api/teams/${team.id}`, { method: 'DELETE' });
            await onDeleted();
          }}
        >删除团队</Button>
      </div>

      <div className="space-y-2 border-t border-border/50 pt-4">
        <div className="flex items-center justify-between">
          <Label>成员({refs.length})</Label>
          <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>管理成员</Button>
        </div>
        {refs.length === 0 && <p className="text-sm text-muted-foreground py-2">还没有成员——点「管理成员」从成员库挑人。</p>}
        <div className="space-y-2">
          {refs.map((ref) => {
            const preset = memberOf(ref.presetId);
            return (
              <div key={ref.presetId} className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2">
                <div className="flex-1 min-w-0">
                  {preset ? (
                    <>
                      <span className="text-sm font-medium">{preset.name}</span>
                      {preset.position && <span className="ml-2 text-xs text-primary">{preset.position}</span>}
                      <p className="text-xs text-muted-foreground truncate">
                        {preset.responsibility || '(未填写职能——队长按职能派单,建议到成员页补上)'}
                      </p>
                    </>
                  ) : (
                    <>
                      <span className="text-sm text-destructive">成员已被删除</span>
                      <p className="text-xs text-muted-foreground">运行时会自动跳过;建议从团队移除该引用。</p>
                    </>
                  )}
                </div>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  启用
                  <Switch
                    checked={ref.enabled}
                    onCheckedChange={(v) => saveRefs(refs.map((r) => (r.presetId === ref.presetId ? { ...r, enabled: v } : r)))}
                  />
                </label>
                <Button
                  size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground"
                  onClick={() => saveRefs(refs.filter((r) => r.presetId !== ref.presetId))}
                >移除</Button>
              </div>
            );
          })}
        </div>
      </div>

      <MemberPicker
        open={pickerOpen}
        selectedIds={refs.map((r) => r.presetId)}
        onClose={() => setPickerOpen(false)}
        onConfirm={(ids) => {
          setPickerOpen(false);
          const keep = refs.filter((r) => ids.includes(r.presetId));
          const added = ids.filter((id) => !refs.some((r) => r.presetId === id)).map((presetId) => ({ presetId, enabled: true }));
          saveRefs([...keep, ...added]);
        }}
      />
    </div>
  );
}
