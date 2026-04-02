'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface BuiltinRole {
  role: string;
  title: string;
  shortLabel: string;
  scope: 'planning' | 'execution';
  description: string;
  systemPrompt: string;
  defaultSystemPrompt: string;
  hasOverrides: boolean;
  tools: string[];
  defaultTools: string[];
  editableToolOptions: string[];
  capabilityTags: string[];
  concurrencyLimit?: number;
  defaultConcurrencyLimit?: number;
  plannerTimeoutMs?: number;
  defaultPlannerTimeoutMs?: number;
  plannerMaxRetries?: number;
  defaultPlannerMaxRetries?: number;
}

const ROLE_ICONS: Record<string, string> = {
  scheduling: '🧭',
  worker: '⚡',
  researcher: '🔍',
  coder: '👨‍💻',
  integration: '🔗',
};

const SCOPE_STYLE: Record<string, string> = {
  planning: 'border-l-sky-500 bg-sky-500/5',
  execution: 'border-l-emerald-500 bg-emerald-500/5',
};

const SCOPE_BADGE: Record<string, string> = {
  planning: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  execution: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
};

function BuiltinRoleCard({
  role,
  onEdit,
  onReset,
}: {
  role: BuiltinRole;
  onEdit: (r: BuiltinRole) => void;
  onReset: (r: BuiltinRole) => void;
}) {
  const icon = ROLE_ICONS[role.role] || '🤖';
  return (
    <div className={`group rounded-lg border border-border/60 bg-card p-4 border-l-[3px] ${SCOPE_STYLE[role.scope]} hover:shadow-md hover:border-border transition-all`}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center text-base shrink-0">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-medium text-sm">{role.shortLabel}</span>
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${SCOPE_BADGE[role.scope]}`}>
              {role.scope === 'planning' ? '规划' : '执行'}
            </Badge>
            {role.hasOverrides && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                已自定义
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-1">{role.description}</p>
          {/* Tool tags */}
          <div className="flex flex-wrap gap-1 mt-2">
            {role.tools.map(t => (
              <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/80 text-muted-foreground">
                {t}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {role.hasOverrides && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onReset(role)}>恢复默认</Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onEdit(role)}>编辑</Button>
        </div>
      </div>
    </div>
  );
}

function BuiltinRoleEditor({
  open,
  role,
  onClose,
  onSaved,
}: {
  open: boolean;
  role: BuiltinRole | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [tools, setTools] = useState<string[]>([]);
  const [concurrency, setConcurrency] = useState('');
  const [timeout, setTimeout] = useState('');
  const [retries, setRetries] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && role) {
      setPrompt(role.systemPrompt);
      setTools([...role.tools]);
      setConcurrency(role.concurrencyLimit != null ? String(role.concurrencyLimit) : '');
      setTimeout(role.plannerTimeoutMs != null ? String(role.plannerTimeoutMs) : '');
      setRetries(role.plannerMaxRetries != null ? String(role.plannerMaxRetries) : '');
      setError('');
      setSaving(false);
    }
  }, [open, role]);

  if (!role) return null;

  const isPlanning = role.scope === 'planning';

  async function handleSave() {
    if (!role) return;
    setSaving(true);
    setError('');
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: Record<string, any> = { systemPrompt: prompt };
      if (isPlanning) {
        if (timeout) body.plannerTimeoutMs = Number(timeout);
        if (retries) body.plannerMaxRetries = Number(retries);
      } else {
        body.allowedTools = tools;
        if (concurrency) body.concurrencyLimit = Number(concurrency);
      }
      const res = await fetch(`/api/workflow/agents/${role.role}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error || '保存失败');
        return;
      }
      onSaved();
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑 {role.shortLabel}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-center gap-2 text-sm">
            <span>{ROLE_ICONS[role.role]}</span>
            <span className="font-medium">{role.title}</span>
            <Badge variant="outline" className={`text-xs ${SCOPE_BADGE[role.scope]}`}>
              {role.scope === 'planning' ? '规划层' : '执行层'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{role.description}</p>

          <div className="space-y-1.5">
            <Label>系统提示词</Label>
            <Textarea value={prompt} onChange={e => setPrompt(e.target.value)} className="min-h-[160px] font-mono text-xs" />
          </div>

          {isPlanning ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>规划超时 (ms)</Label>
                <Input type="number" min={5000} max={120000} step={1000} value={timeout} onChange={e => setTimeout(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>最大重试次数</Label>
                <Input type="number" min={0} max={5} step={1} value={retries} onChange={e => setRetries(e.target.value)} />
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label>允许的工具</Label>
                <div className="space-y-2">
                  {role.editableToolOptions.map(t => (
                    <label key={t} className="flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer hover:bg-accent/30 transition-colors">
                      <Checkbox
                        checked={tools.includes(t)}
                        onCheckedChange={checked => setTools(prev => checked ? [...new Set([...prev, t])] : prev.filter(x => x !== t))}
                      />
                      <span className="text-sm font-medium">{t}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>并发限制</Label>
                <Input type="number" min={1} max={10} step={1} value={concurrency} onChange={e => setConcurrency(e.target.value)} />
              </div>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>取消</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BuiltinAgentSection() {
  const [roles, setRoles] = useState<BuiltinRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<BuiltinRole | null>(null);

  const loadRoles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/workflow/agents', { cache: 'no-store' });
      const data = await res.json();
      setRoles(Array.isArray(data.roles) ? data.roles : []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadRoles(); }, [loadRoles]);

  const handleEdit = useCallback((r: BuiltinRole) => {
    setEditTarget(r);
    setEditOpen(true);
  }, []);

  const handleReset = useCallback(async (r: BuiltinRole) => {
    if (!confirm(`确认恢复「${r.shortLabel}」为默认配置？`)) return;
    await fetch(`/api/workflow/agents/${r.role}`, { method: 'DELETE' });
    await loadRoles();
  }, [loadRoles]);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold tracking-tight">系统 Agent</h3>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">内置</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          工作流引擎的内置角色，可自定义提示词和工具权限
        </p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 rounded-lg border border-border/40 bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {roles.map(r => (
            <BuiltinRoleCard key={r.role} role={r} onEdit={handleEdit} onReset={handleReset} />
          ))}
        </div>
      )}

      <BuiltinRoleEditor open={editOpen} role={editTarget} onClose={() => setEditOpen(false)} onSaved={loadRoles} />
    </div>
  );
}
