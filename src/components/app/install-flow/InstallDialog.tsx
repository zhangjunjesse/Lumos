'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import type { ConsentRequest, ConsentResponse } from '@/lib/app/installer';
import type { PermissionDescriptor } from '@/lib/app/installer/permissions';

export interface InstallDialogProps {
  open: boolean;
  request: ConsentRequest | null;
  onConfirm: (response: ConsentResponse) => void;
  onCancel: () => void;
}

const LEVEL_STYLES: Record<PermissionDescriptor['level'], string> = {
  safe: 'border-green-500/30 bg-green-500/5',
  moderate: 'border-yellow-500/30 bg-yellow-500/5',
  high: 'border-destructive/30 bg-destructive/5',
};

const LEVEL_LABEL: Record<PermissionDescriptor['level'], string> = {
  safe: '低风险',
  moderate: '中风险',
  high: '高风险',
};

export function InstallDialog({ open, request, onConfirm, onCancel }: InstallDialogProps): React.ReactElement | null {
  const [granted, setGranted] = React.useState<Set<string>>(() => new Set());

  React.useEffect(() => {
    if (request) {
      // Default: pre-check safe + moderate, leave high unchecked.
      const initial = new Set<string>();
      for (const p of request.permissions) {
        if (p.level !== 'high') initial.add(p.permission);
      }
      setGranted(initial);
    }
  }, [request]);

  if (!request) return null;

  const toggle = (perm: string) => {
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {request.isUpgrade ? '更新应用：' : '安装应用：'}
            {request.manifest.name}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              v{request.manifest.version}
              {request.previousVersion ? ` (← v${request.previousVersion})` : ''}
            </span>
          </DialogTitle>
          {request.manifest.description ? (
            <DialogDescription>{request.manifest.description}</DialogDescription>
          ) : null}
        </DialogHeader>

        {request.permissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">本应用未申请任何权限。</p>
        ) : (
          <div className="flex max-h-96 flex-col gap-2 overflow-y-auto py-2">
            <p className="text-sm text-muted-foreground">
              请勾选你愿意授予的权限。未勾选的项目在应用运行时将被拒绝。
            </p>
            {request.permissions.map((p) => (
              <label
                key={p.permission}
                className={`flex cursor-pointer items-start gap-3 rounded border p-3 ${LEVEL_STYLES[p.level]}`}
              >
                <Checkbox
                  checked={granted.has(p.permission)}
                  onCheckedChange={() => toggle(p.permission)}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide">
                      {LEVEL_LABEL[p.level]}
                    </span>
                    <code className="text-xs text-muted-foreground">{p.permission}</code>
                  </div>
                  <p className="text-sm">{p.description}</p>
                </div>
              </label>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={() => onConfirm({ granted: Array.from(granted) })}>
            {request.isUpgrade ? '更新' : '安装'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
