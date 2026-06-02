'use client';

// 设置「危险操作」区:清空图库 / 清空已采集商品(二次确认)。纯展示,动作回调给 SettingsTab。

import { Button } from '@/components/ui/button';

export function DangerZoneSection({
  busy,
  msg,
  onClear,
}: {
  busy: 'clear-library' | 'clear-products' | null;
  msg: string | null;
  onClear: (action: 'clear-library' | 'clear-products', confirmText: string) => void;
}) {
  return (
    <section className="rounded-lg border border-destructive/30 bg-card p-5">
      <h2 className="mb-3 text-sm font-medium text-destructive">危险操作</h2>
      {msg && <p className="mb-3 rounded bg-muted p-2 text-xs text-muted-foreground">{msg}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => onClear('clear-library', '确认清空图库？所有采集的详情图记录删除，不可恢复。')}>
          {busy === 'clear-library' ? '清空中…' : '清空图库'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => onClear('clear-products', '确认清空已采集商品？所有采集的商品 + 其详情图全部删除，不可恢复。')}
        >
          {busy === 'clear-products' ? '清空中…' : '清空已采集商品'}
        </Button>
      </div>
    </section>
  );
}
