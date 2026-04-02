'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { WorkflowParamDef } from '@/lib/workflow/types';

const EMPTY_PARAM: WorkflowParamDef = { name: '', type: 'string', description: '', required: false };

interface ParamRowProps {
  param: WorkflowParamDef;
  onEdit: () => void;
  onDelete: () => void;
}

function ParamRow({ param, onEdit, onDelete }: ParamRowProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/40 bg-background group">
      <code className="text-xs font-mono text-primary shrink-0">{param.name}</code>
      <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0">{param.type}</Badge>
      <span className="text-xs text-muted-foreground flex-1 truncate">{param.description || '—'}</span>
      {param.required && <span className="text-[10px] text-destructive shrink-0">必填</span>}
      {param.default !== undefined && (
        <span className="text-[10px] text-muted-foreground shrink-0">默认: {String(param.default)}</span>
      )}
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button onClick={onEdit} className="text-[10px] text-primary hover:underline">编辑</button>
        <button onClick={onDelete} className="text-[10px] text-destructive hover:underline">删除</button>
      </div>
    </div>
  );
}

interface ParamFormProps {
  initial: WorkflowParamDef;
  existingNames: string[];
  onSave: (p: WorkflowParamDef) => void;
  onCancel: () => void;
}

function ParamForm({ initial, existingNames, onSave, onCancel }: ParamFormProps) {
  const [form, setForm] = useState<WorkflowParamDef>(initial);
  const [nameErr, setNameErr] = useState('');

  function set<K extends keyof WorkflowParamDef>(key: K, value: WorkflowParamDef[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
    if (key === 'name') setNameErr('');
  }

  function handleSave() {
    const name = form.name.trim();
    if (!name) { setNameErr('参数名不能为空'); return; }
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) { setNameErr('只允许字母、数字、下划线，且以字母开头'); return; }
    if (existingNames.includes(name)) { setNameErr('参数名已存在'); return; }
    onSave({ ...form, name, description: form.description?.trim() || undefined });
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">参数名 *</Label>
          <Input value={form.name} onChange={e => set('name', e.target.value)}
            className="h-7 text-xs font-mono" placeholder="如 topic" />
          {nameErr && <p className="text-[10px] text-destructive">{nameErr}</p>}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">类型</Label>
          <Select value={form.type} onValueChange={v => set('type', v as WorkflowParamDef['type'])}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="string">string</SelectItem>
              <SelectItem value="number">number</SelectItem>
              <SelectItem value="boolean">boolean</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">说明（展示给用户）</Label>
        <Input value={form.description ?? ''} onChange={e => set('description', e.target.value)}
          className="h-7 text-xs" placeholder="如：搜索主题关键词" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">默认值（可选）</Label>
          <Input value={form.default !== undefined ? String(form.default) : ''}
            onChange={e => set('default', e.target.value === '' ? undefined : e.target.value)}
            className="h-7 text-xs" placeholder="留空表示无默认" />
        </div>
        <div className="flex items-end gap-2 pb-0.5">
          <Switch checked={!!form.required} onCheckedChange={v => set('required', v)} />
          <span className="text-xs text-muted-foreground">必填</span>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onCancel}>取消</Button>
        <Button size="sm" className="h-7 text-xs" onClick={handleSave}>确认</Button>
      </div>
    </div>
  );
}

interface WorkflowParamManagerProps {
  params: WorkflowParamDef[];
  onChange: (params: WorkflowParamDef[]) => void;
}

export function WorkflowParamManager({ params, onChange }: WorkflowParamManagerProps) {
  const [adding, setAdding] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  function handleAdd(p: WorkflowParamDef) {
    onChange([...params, p]);
    setAdding(false);
  }

  function handleEdit(idx: number, p: WorkflowParamDef) {
    const next = params.map((old, i) => i === idx ? p : old);
    onChange(next);
    setEditingIdx(null);
  }

  function handleDelete(idx: number) {
    onChange(params.filter((_, i) => i !== idx));
  }

  const otherNames = (excludeIdx: number) => params.filter((_, i) => i !== excludeIdx).map(p => p.name);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">工作流参数</span>
          {params.length > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{params.length}</Badge>
          )}
          <span className="text-[10px] text-muted-foreground">步骤 Prompt 里用 <code className="bg-muted px-1 rounded">{'{{'}input.参数名{'}}'}</code> 插入</span>
        </div>
        {!adding && editingIdx === null && (
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setAdding(true)}>
            + 添加参数
          </Button>
        )}
      </div>

      {params.length === 0 && !adding && (
        <div className="text-[11px] text-muted-foreground py-1.5 px-3 rounded-lg border border-dashed border-border/40 text-center">
          暂无参数，添加后可在步骤 Prompt 里用 {'{{'}input.xxx{'}}'}  动态插入
        </div>
      )}

      {params.map((p, i) => (
        editingIdx === i ? (
          <ParamForm
            key={i}
            initial={p}
            existingNames={otherNames(i)}
            onSave={updated => handleEdit(i, updated)}
            onCancel={() => setEditingIdx(null)}
          />
        ) : (
          <ParamRow key={p.name} param={p} onEdit={() => setEditingIdx(i)} onDelete={() => handleDelete(i)} />
        )
      ))}

      {adding && (
        <ParamForm
          initial={EMPTY_PARAM}
          existingNames={params.map(p => p.name)}
          onSave={handleAdd}
          onCancel={() => setAdding(false)}
        />
      )}
    </div>
  );
}
