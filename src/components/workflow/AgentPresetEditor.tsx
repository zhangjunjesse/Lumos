'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AgentPresetDirectoryItem } from '@/types';

interface ModelOption { providerId: string; providerName: string; value: string; label: string }
interface ProviderOption { id: string; name: string }

export interface MemberFormData {
  name: string; position: string; description: string;
  systemPrompt: string; preferredModel: string; providerId: string;
  departmentId: string;
}

function defaultForm(initial?: AgentPresetDirectoryItem | null): MemberFormData {
  return {
    name: initial?.name ?? '', position: initial?.position ?? '',
    description: initial?.description ?? '',
    systemPrompt: initial?.systemPrompt ?? '',
    preferredModel: initial?.preferredModel ?? '', providerId: initial?.providerId ?? '',
    departmentId: initial?.departmentId ?? '',
  };
}

// ── Random identity generator ──
const R_SURNAMES = ['李', '王', '张', '刘', '陈', '杨', '赵', '吴', '林', '郑', '徐', '孙', '高', '何', '谢'];
const R_GIVEN = ['明远', '思源', '浩然', '嘉琪', '晓雯', '志远', '若冰', '文博', '锦程', '艺馨', '景辉', '天赐', '玲珑', '雨桐', '星瀚', '墨言', '慧心', '子默', '卿云', '逸飞'];
const R_POSITIONS = ['资深研究员', '内容策划师', '数据分析师', '产品经理', '技术架构师', '创意总监', '市场分析师', '运营专家', 'AI 工程师', '策略顾问', '知识管理专员', '品牌传播官', '深度学习工程师', '全栈工程师', '用户体验设计师', '情报分析师', '首席信息官', '智能助理', '商务拓展经理', '知识图谱专家'];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

function randomIdentity(): Pick<MemberFormData, 'name' | 'position'> {
  return {
    name: pick(R_SURNAMES) + pick(R_GIVEN),
    position: pick(R_POSITIONS),
  };
}

// ── Avatar helpers ──
const AVATAR_COLORS = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-indigo-500'];
function avatarColor(id: string): string {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

interface MemberEditorProps {
  open: boolean;
  initial?: AgentPresetDirectoryItem | null;
  onClose: () => void;
  onSave: (data: MemberFormData) => Promise<string>;
}

export function MemberEditor({ open, initial, onClose, onSave }: MemberEditorProps) {
  const [form, setForm] = useState<MemberFormData>(() => defaultForm(initial));
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('identity');
  const [localHasAvatar, setLocalHasAvatar] = useState(Boolean(initial?.avatarPath));
  const [avatarError, setAvatarError] = useState(false);
  const [avatarRefresh, setAvatarRefresh] = useState(0);
  const [canGenerate, setCanGenerate] = useState(false);
  const [showGenBox, setShowGenBox] = useState(false);
  const [genPrompt, setGenPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genAvatarErr, setGenAvatarErr] = useState('');
  const [showAiBox, setShowAiBox] = useState(false);
  const [aiDesc, setAiDesc] = useState('');
  const [aiWorking, setAiWorking] = useState(false);
  const [aiErr, setAiErr] = useState('');
  const [models, setModels] = useState<ModelOption[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const savedIdRef = useRef(initial?.id ?? '');

  useEffect(() => {
    if (!open) return;
    setForm(defaultForm(initial));
    setSaving(false); setTab('identity');
    setLocalHasAvatar(Boolean(initial?.avatarPath)); setAvatarError(false);
    setShowGenBox(false); setGenPrompt(''); setGenAvatarErr('');
    setShowAiBox(false); setAiDesc(''); setAiErr('');
    savedIdRef.current = initial?.id ?? '';
  }, [open, initial]);

  useEffect(() => {
    if (!open || !initial?.id) { setCanGenerate(false); return; }
    fetch(`/api/workflow/agent-presets/${initial.id}/avatar?check=1`)
      .then(r => r.json()).then((d: { canGenerate?: boolean }) => setCanGenerate(Boolean(d.canGenerate)))
      .catch(() => setCanGenerate(false));
  }, [open, initial?.id]);

  useEffect(() => {
    if (!open) return;
    fetch('/api/workflow/departments').then(r => r.json()).then((d: { departments?: { id: string; name: string }[] }) => {
      setDepartments(d.departments || []);
    }).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    fetch('/api/providers/models').then(r => r.json()).then(data => {
      const ms: ModelOption[] = []; const ps: ProviderOption[] = [];
      for (const g of data.groups || []) {
        ps.push({ id: g.provider_id, name: g.provider_name });
        for (const m of g.models || []) ms.push({ providerId: g.provider_id, providerName: g.provider_name, value: m.value, label: m.label });
      }
      setModels(ms); setProviders(ps);
    }).catch(() => {});
  }, [open]);

  function set<K extends keyof MemberFormData>(k: K, v: MemberFormData[K]) {
    setForm(p => ({ ...p, [k]: v }));
  }

  function handleRandom() {
    setForm(p => ({ ...p, ...randomIdentity() }));
  }

  async function uploadAvatar(file: File) {
    const id = savedIdRef.current; if (!id) return;
    const fd = new FormData(); fd.append('file', file);
    await fetch(`/api/workflow/agent-presets/${id}/avatar`, { method: 'POST', body: fd });
    setLocalHasAvatar(true); setAvatarError(false); setAvatarRefresh(n => n + 1);
  }

  function openGenBox() {
    const name = form.name.trim();
    const pos = form.position.trim();
    const def = `专业头像，扁平插画风格，卡通人物${name ? `，姓名：${name}` : ''}${pos ? `，职位：${pos}` : ''}。友好表情，纯色背景，简约设计，正方形构图。`;
    setGenPrompt(def);
    setShowGenBox(true);
    setGenAvatarErr('');
  }

  async function generateAvatar() {
    const id = savedIdRef.current; if (!id) return;
    setGenerating(true); setGenAvatarErr('');
    try {
      const res = await fetch(`/api/workflow/agent-presets/${id}/avatar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate', prompt: genPrompt.trim() || undefined }),
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) { setGenAvatarErr(d.error || '生成失败'); return; }
      setLocalHasAvatar(true); setAvatarError(false); setAvatarRefresh(n => n + 1);
      setShowGenBox(false);
    } catch { setGenAvatarErr('网络错误'); } finally { setGenerating(false); }
  }

  async function handleAiGenerate() {
    if (!aiDesc.trim()) return;
    setAiWorking(true); setAiErr('');
    try {
      const body: Record<string, unknown> = { description: aiDesc.trim() };
      if (form.providerId) body.providerId = form.providerId;
      if (form.preferredModel) body.model = form.preferredModel;
      const res = await fetch('/api/workflow/agent-presets/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await res.json() as { config?: { name: string; systemPrompt: string; description: string }; error?: string };
      if (!res.ok || !d.config) { setAiErr(d.error || '生成失败，请重试'); return; }
      setForm(p => ({ ...p, name: d.config!.name || p.name, systemPrompt: d.config!.systemPrompt || p.systemPrompt, description: d.config!.description || p.description }));
      setShowAiBox(false);
    } finally { setAiWorking(false); }
  }

  async function handleSave() {
    if (!form.name.trim() || !form.systemPrompt.trim()) return;
    setSaving(true);
    try { savedIdRef.current = await onSave(form); onClose(); } finally { setSaving(false); }
  }

  const hasId = Boolean(initial?.id);
  const showImg = localHasAvatar && !avatarError;
  const bgColor = hasId ? avatarColor(initial!.id) : 'bg-muted';
  const canSave = form.name.trim() && form.systemPrompt.trim();

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-none w-[min(900px,calc(100vw-2rem))] max-h-[90vh] flex flex-col gap-0 p-0 overflow-x-hidden">
        <DialogHeader className="px-6 pt-5 pb-0 shrink-0">
          <DialogTitle>{hasId ? '编辑成员' : '新建成员'}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden px-6 pt-4">
          <TabsList className="w-fit shrink-0 mb-4">
            <TabsTrigger value="identity">基本信息</TabsTrigger>
            <TabsTrigger value="capability">AI 能力</TabsTrigger>
          </TabsList>

          {/* ── Tab 1: 基本信息 ── */}
          <TabsContent value="identity" className="overflow-y-auto space-y-5 pb-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">填写成员的个人身份信息</p>
              <Button variant="outline" size="sm" onClick={handleRandom} className="h-7 text-xs gap-1.5">
                🎲 随机生成
              </Button>
            </div>

            <div className="flex gap-5 items-start">
              {/* Avatar column */}
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <div
                  className={`w-20 h-20 rounded-full overflow-hidden flex items-center justify-center text-white font-bold text-2xl cursor-pointer ring-2 ring-border/40 hover:ring-border transition-all ${showImg ? '' : bgColor}`}
                  onClick={() => fileRef.current?.click()}
                  title="点击上传头像"
                >
                  {showImg
                    ? <img key={`${initial!.id}-${avatarRefresh}`} src={`/api/workflow/agent-presets/${initial!.id}/avatar?t=${avatarRefresh}`} alt="" className="w-full h-full object-cover" onError={() => setAvatarError(true)} />
                    : (form.name.trim().slice(0, 2) || '?')}
                </div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void uploadAvatar(f); }} />
                <button type="button" className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => fileRef.current?.click()}>上传头像</button>
                {canGenerate && !showGenBox && (
                  <button type="button" disabled={!savedIdRef.current} className="text-[10px] text-primary hover:text-primary/80 disabled:opacity-40" onClick={openGenBox}>
                    ✨ AI 生成
                  </button>
                )}
              </div>

              {/* Fields */}
              <div className="flex-1 space-y-3">
                <div className="space-y-1.5">
                  <Label>姓名 <span className="text-destructive">*</span></Label>
                  <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="例如：李明远" />
                </div>
                <div className="space-y-1.5">
                  <Label>职位</Label>
                  <Input value={form.position} onChange={e => set('position', e.target.value)} placeholder="例如：资深研究员" />
                </div>
                {departments.length > 0 && (
                  <div className="space-y-1.5">
                    <Label>所属部门</Label>
                    <Select value={form.departmentId || '__none__'} onValueChange={v => set('departmentId', v === '__none__' ? '' : v)}>
                      <SelectTrigger><SelectValue placeholder="不分配部门" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">不分配部门</SelectItem>
                        {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>

            {/* AI 生成头像提示词区 */}
            {showGenBox && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                <p className="text-xs font-medium text-primary">AI 生成头像 — 自定义提示词</p>
                <Textarea
                  value={genPrompt}
                  onChange={e => setGenPrompt(e.target.value)}
                  placeholder="描述希望生成的头像风格、外貌特征..."
                  className="min-h-[72px] text-sm"
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void generateAvatar(); }}
                />
                {genAvatarErr && <p className="text-xs text-destructive">{genAvatarErr}</p>}
                <div className="flex gap-2">
                  <Button size="sm" onClick={generateAvatar} disabled={generating || !genPrompt.trim()}>
                    {generating ? '生成中...' : '✨ 生成'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setShowGenBox(false); setGenAvatarErr(''); }}>取消</Button>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>一句话介绍</Label>
              <Input value={form.description} onChange={e => set('description', e.target.value)} placeholder="例如：专注于 AI 资讯采集与深度分析的研究员" />
            </div>
          </TabsContent>

          {/* ── Tab 2: AI 能力 ── */}
          <TabsContent value="capability" className="overflow-y-auto space-y-4 pb-2">
            {/* AI auto-generate box */}
            <div className="rounded-lg border border-dashed border-border/60 p-3">
              {showAiBox ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">描述职责，AI 自动生成系统提示词</p>
                  <Textarea value={aiDesc} onChange={e => setAiDesc(e.target.value)} placeholder="例如：一个专注于数据分析的助理，能处理 CSV 数据并生成洞察报告" className="min-h-[72px] text-sm" onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleAiGenerate(); }} />
                  {aiErr && <p className="text-xs text-destructive">{aiErr}</p>}
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleAiGenerate} disabled={aiWorking || !aiDesc.trim()}>{aiWorking ? '生成中...' : '✨ 生成'}</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setShowAiBox(false); setAiErr(''); }}>取消</Button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setShowAiBox(true)} className="w-full text-xs text-muted-foreground hover:text-foreground text-center transition-colors">
                  ✨ 用 AI 自动生成能力配置
                </button>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>系统提示词 <span className="text-destructive">*</span></Label>
              <Textarea value={form.systemPrompt} onChange={e => set('systemPrompt', e.target.value)} placeholder="定义成员的行为方式、专业知识范围和输出风格..." className="min-h-[140px] font-mono text-sm" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              {providers.length > 0 && (
                <div className="space-y-1.5">
                  <Label>服务商</Label>
                  <Select value={form.providerId || '__default__'} onValueChange={v => set('providerId', v === '__default__' ? '' : v)}>
                    <SelectTrigger><SelectValue placeholder="使用默认" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">使用默认服务商</SelectItem>
                      {providers.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>模型</Label>
                <Select value={form.preferredModel || '__default__'} onValueChange={v => set('preferredModel', v === '__default__' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="使用默认模型" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">使用默认模型</SelectItem>
                    {models.filter(m => !form.providerId || m.providerId === form.providerId).map(m => (
                      <SelectItem key={`${m.providerId}/${m.value}`} value={m.value}>
                        <span className="text-muted-foreground text-xs mr-1">[{m.providerName}]</span>{m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="px-6 py-4 border-t border-border/50 shrink-0">
          <Button variant="outline" onClick={onClose} disabled={saving}>取消</Button>
          <Button onClick={handleSave} disabled={saving || !canSave}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { MemberEditor as AgentPresetEditor };
export type { MemberFormData as AgentPresetFormData };
