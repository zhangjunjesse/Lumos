'use client';

import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2 } from 'lucide-react';
import type { SavedConfig } from './shared';

interface Props {
  target: SavedConfig | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

export function ProviderDeleteDialog({ target, onOpenChange, onDeleted }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    if (!target) return;
    setDeleting(true);
    setError('');
    try {
      const res = await fetch(`/api/providers/${target.id}`, { method: 'DELETE' });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        onDeleted();
        return;
      }
      setError(data.error || '删除配置失败');
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除配置失败');
    } finally {
      setDeleting(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) setError('');
    onOpenChange(open);
  };

  return (
    <AlertDialog open={!!target} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>
            确定要删除 <strong>{target?.name}</strong> 吗？此操作无法撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
            <p className="text-xs font-medium text-destructive">删除失败</p>
            <p className="mt-0.5 text-xs text-destructive/80">{error}</p>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
