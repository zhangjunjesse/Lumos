'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { AgentPresetDirectoryItem } from '@/types';
import { MemberEditor, type MemberFormData } from './AgentPresetEditor';

interface Department { id: string; name: string; description: string; sortOrder: number }

function getInitials(name: string): string {
  return name.trim().slice(0, 2) || '?';
}

const AVATAR_BG_COLORS = [
  'bg-blue-500', 'bg-violet-500', 'bg-emerald-500',
  'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-indigo-500',
];

function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffff;
  return AVATAR_BG_COLORS[hash % AVATAR_BG_COLORS.length];
}

function MemberAvatar({ id, name, avatarPath, size = 64 }: {
  id: string; name: string; avatarPath?: string; size?: number;
}) {
  const [imgError, setImgError] = useState(false);
  const showImg = avatarPath && !imgError;
  const s = `${size}px`;
  return (
    <div
      className={`rounded-full shrink-0 overflow-hidden flex items-center justify-center text-white font-semibold ${showImg ? '' : avatarColor(id)}`}
      style={{ width: s, height: s, fontSize: size * 0.35 }}
    >
      {showImg ? (
        <img src={`/api/workflow/agent-presets/${id}/avatar`} alt={name} className="w-full h-full object-cover" onError={() => setImgError(true)} />
      ) : getInitials(name)}
    </div>
  );
}

function MemberCard({ preset, onEdit, onDelete, onDuplicate }: {
  preset: AgentPresetDirectoryItem;
  onEdit: (p: AgentPresetDirectoryItem) => void;
  onDelete: (id: string) => void;
  onDuplicate: (p: AgentPresetDirectoryItem) => void;
}) {
  return (
    <div
      className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 transition-all hover:border-border hover:shadow-sm cursor-pointer"
      onClick={() => onEdit(preset)}
    >
      <MemberAvatar id={preset.id} name={preset.name} avatarPath={preset.avatarPath} size={44} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-sm truncate">{preset.name}</span>
            {preset.position && (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary leading-none">
                {preset.position}
              </span>
            )}
          </div>
          <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={e => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground">···</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(preset)}>编辑</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDuplicate(preset)}>复制</DropdownMenuItem>
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(preset.id)}>删除</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground truncate">{preset.description || preset.responsibility || '暂无简介'}</p>
      </div>
    </div>
  );
}

function DepartmentSection({ dept, members, onEdit, onDelete, onDuplicate, onEditDept, onDeleteDept }: {
  dept: Department | null;
  members: AgentPresetDirectoryItem[];
  onEdit: (p: AgentPresetDirectoryItem) => void;
  onDelete: (id: string) => void;
  onDuplicate: (p: AgentPresetDirectoryItem) => void;
  onEditDept?: (d: Department) => void;
  onDeleteDept?: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {dept ? dept.name : '未分配'}
          </span>
          <span className="text-xs text-muted-foreground/60">({members.length})</span>
        </div>
        {dept && onEditDept && onDeleteDept && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-muted-foreground">···</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEditDept(dept)}>编辑部门</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDeleteDept(dept.id)}>删除部门</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {members.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {members.map(m => (
            <MemberCard key={m.id} preset={m} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/50 px-1 py-2">暂无成员</p>
      )}
    </div>
  );
}

function DeptDialog({ open, initial, onClose, onSave }: {
  open: boolean;
  initial?: Department | null;
  onClose: () => void;
  onSave: (name: string, description: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setName(initial?.name ?? ''); setDescription(initial?.description ?? ''); setSaving(false); }
  }, [open, initial]);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-none w-[min(440px,calc(100vw-2rem))]">
        <DialogHeader><DialogTitle>{initial ? '编辑部门' : '新建部门'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">部门名称 <span className="text-destructive">*</span></label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="例如：研发部门" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">简介</label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="部门职能简介（可选）" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>取消</Button>
          <Button disabled={saving || !name.trim()} onClick={async () => { setSaving(true); try { await onSave(name.trim(), description.trim()); onClose(); } finally { setSaving(false); } }}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AgentPresetList() {
  const [members, setMembers] = useState<AgentPresetDirectoryItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AgentPresetDirectoryItem | null>(null);
  const [deptDialogOpen, setDeptDialogOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const editorTargetRef = useRef<AgentPresetDirectoryItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [presetsRes, deptsRes] = await Promise.all([
        fetch('/api/workflow/agent-presets'),
        fetch('/api/workflow/departments'),
      ]);
      const [presetsData, deptsData] = await Promise.all([
        presetsRes.json() as Promise<{ presets?: AgentPresetDirectoryItem[] }>,
        deptsRes.json() as Promise<{ departments?: Department[] }>,
      ]);
      setMembers(presetsData.presets || []);
      setDepartments(deptsData.departments || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openCreate = useCallback(() => {
    editorTargetRef.current = null; setEditTarget(null); setEditorOpen(true);
  }, []);

  const handleEdit = useCallback((p: AgentPresetDirectoryItem) => {
    editorTargetRef.current = p; setEditTarget(p); setEditorOpen(true);
  }, []);

  const handleDuplicate = useCallback((p: AgentPresetDirectoryItem) => {
    const dup = { ...p, id: '', name: `${p.name} (副本)` };
    editorTargetRef.current = dup; setEditTarget(dup); setEditorOpen(true);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('确认从团队中移除这名成员？')) return;
    await fetch(`/api/workflow/agent-presets/${id}`, { method: 'DELETE' });
    await load();
  }, [load]);

  const handleSave = useCallback(async (data: MemberFormData): Promise<string> => {
    const body = {
      name: data.name, systemPrompt: data.systemPrompt,
      ...(data.description ? { description: data.description } : {}),
      ...(data.preferredModel ? { preferredModel: data.preferredModel } : {}),
      ...(data.providerId ? { providerId: data.providerId } : {}),
      ...(data.position ? { position: data.position } : {}),
      departmentId: data.departmentId || null,
    };
    const isEdit = editorTargetRef.current?.id;
    let savedId: string;
    if (isEdit) {
      await fetch(`/api/workflow/agent-presets/${editorTargetRef.current!.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      savedId = editorTargetRef.current!.id;
    } else {
      const res = await fetch('/api/workflow/agent-presets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const result = await res.json() as { preset?: { id: string } };
      savedId = result.preset?.id || '';
      editorTargetRef.current = result.preset ? { ...editorTargetRef.current!, id: savedId } : null;
    }
    await load();
    return savedId;
  }, [load]);

  const handleSaveDept = useCallback(async (name: string, description: string) => {
    if (editingDept) {
      await fetch(`/api/workflow/departments/${editingDept.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description }),
      });
    } else {
      await fetch('/api/workflow/departments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description }),
      });
    }
    await load();
  }, [editingDept, load]);

  const handleDeleteDept = useCallback(async (id: string) => {
    if (!confirm('确认删除该部门？部门成员将移至未分配。')) return;
    await fetch(`/api/workflow/departments/${id}`, { method: 'DELETE' });
    await load();
  }, [load]);

  // Group members by department
  const membersByDept = new Map<string | null, AgentPresetDirectoryItem[]>();
  for (const m of members) {
    const key = m.departmentId ?? null;
    if (!membersByDept.has(key)) membersByDept.set(key, []);
    membersByDept.get(key)!.push(m);
  }
  const unassigned = membersByDept.get(null) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">我的团队</h2>
          <p className="text-sm text-muted-foreground">打造你的 AI 团队，按部门组织成员</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => { setEditingDept(null); setDeptDialogOpen(true); }}>+ 新建部门</Button>
          <Button onClick={openCreate}>+ 新建成员</Button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3].map(i => <div key={i} className="h-24 rounded-xl border border-border/40 bg-muted/30 animate-pulse" />)}
        </div>
      ) : members.length === 0 && departments.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border/60 bg-muted/10 py-16 text-center">
          <div className="text-5xl">👥</div>
          <div>
            <p className="text-sm font-medium">团队暂无成员</p>
            <p className="text-xs text-muted-foreground mt-1">创建部门和 AI 成员，构建你的专属团队</p>
          </div>
          <Button onClick={openCreate}>招募第一位成员</Button>
        </div>
      ) : (
        <div className="space-y-6">
          {departments.map(dept => (
            <DepartmentSection
              key={dept.id}
              dept={dept}
              members={membersByDept.get(dept.id) ?? []}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
              onEditDept={d => { setEditingDept(d); setDeptDialogOpen(true); }}
              onDeleteDept={handleDeleteDept}
            />
          ))}
          {unassigned.length > 0 && (
            <DepartmentSection
              dept={null}
              members={unassigned}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
            />
          )}
        </div>
      )}

      <MemberEditor open={editorOpen} initial={editTarget} onClose={() => setEditorOpen(false)} onSave={handleSave} />
      <DeptDialog open={deptDialogOpen} initial={editingDept} onClose={() => setDeptDialogOpen(false)} onSave={handleSaveDept} />
    </div>
  );
}
