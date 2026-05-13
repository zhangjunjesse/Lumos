'use client';

import * as React from 'react';

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

/**
 * Confirmation dialog for bulk discard / restore. Owned by LibraryTab,
 * extracted in round 7 to keep the parent under the 300-line hard limit.
 *
 * Pure presentation: parent owns state and runs the actual mutation in
 * `onConfirm`. Caller decides what to do with the result (toast / refresh).
 */
export function BulkStatusDialog({
  kind,
  videoCount,
  busy,
  onCancel,
  onConfirm,
}: {
  kind: 'discard' | 'restore' | null;
  videoCount: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}): React.ReactElement {
  return (
    <AlertDialog
      open={kind !== null}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {kind === 'discard'
              ? `确认丢弃当前可见的 ${videoCount} 条视频？`
              : `确认恢复当前可见的 ${videoCount} 条视频？`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {kind === 'discard'
              ? '这些视频会被标记为「丢弃」（不删除数据；之后可以在「丢弃」筛选下逐条恢复或一键恢复）。已入库的不在此列。'
              : '这些视频会被恢复到「待整理」（之前的字幕 / 标签 / 备注 / 加星都还在）。'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={() => void onConfirm()}
          >
            {kind === 'discard' ? '确认丢弃' : '确认恢复'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
