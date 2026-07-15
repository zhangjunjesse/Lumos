'use client';

// 团队选人器:从成员库(agent presets)多选加入团队。成员本体的编辑在「成员」页做。

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';

interface PresetOption {
  id: string;
  name: string;
  position?: string;
  responsibility?: string;
  description?: string;
}

export function MemberPicker({ open, selectedIds, onClose, onConfirm }: {
  open: boolean;
  selectedIds: string[];
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
}) {
  const [presets, setPresets] = useState<PresetOption[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- intentional selection reset when dialog opens with new props */
  useEffect(() => {
    if (!open) return;
    setChecked(new Set(selectedIds));
    setLoading(true);
    fetch('/api/workflow/agent-presets')
      .then((r) => r.json())
      .then((d: { presets?: PresetOption[] }) => setPresets(d.presets || []))
      .catch(() => setPresets([]))
      .finally(() => setLoading(false));
  }, [open, selectedIds]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-none w-[min(560px,calc(100vw-2rem))]">
        <DialogHeader><DialogTitle>选择团队成员</DialogTitle></DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto space-y-1 py-1">
          {loading && <p className="text-sm text-muted-foreground py-4 text-center">加载中…</p>}
          {!loading && presets.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">成员库是空的——先到「成员」页创建 AI 成员</p>
          )}
          {presets.map((p) => (
            <label key={p.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent/50 cursor-pointer">
              <Checkbox checked={checked.has(p.id)} onCheckedChange={() => toggle(p.id)} />
              <span className="flex-1 min-w-0">
                <span className="text-sm font-medium">{p.name}</span>
                {p.position && <span className="ml-2 text-xs text-primary">{p.position}</span>}
                <span className="block text-xs text-muted-foreground truncate">
                  {p.responsibility || p.description || '(未填写职能——建议到成员页补上,队长按职能派单)'}
                </span>
              </span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => onConfirm([...checked])}>确定({checked.size})</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
