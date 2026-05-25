'use client';

import * as React from 'react';
import { Loader2, Save, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { GoofishAccount } from '@/components/goofish/use-goofish-auth';

import { nativeActionUrl } from './use-goofish-app-data';
import type { ListingDraft } from './use-product-listings';
import type { Product } from './use-products';

export function ProductAddListingDialog({
  productId,
  productTitle,
  product,
  accounts,
  existingAccountIds,
  onClose,
  onSubmit,
  onAfterPublish,
}: {
  productId: string;
  productTitle: string;
  product: Product | null;
  accounts: GoofishAccount[];
  existingAccountIds: string[];
  onClose: () => void;
  onSubmit: (draft: ListingDraft) => Promise<void>;
  /** 立即发布成功后回调，让父级刷新列表（拿到 item_id 已回填的 listing） */
  onAfterPublish?: () => void;
}): React.ReactElement {
  const eligible = accounts.filter((a) => !existingAccountIds.includes(a.accountUnb) && a.valid);
  const [accountUnb, setAccountUnb] = React.useState(eligible[0]?.accountUnb ?? '');
  const [title, setTitle] = React.useState(product?.title ?? productTitle ?? '');
  const [price, setPrice] = React.useState(() => product?.suggested_price ?? 0);
  const [busy, setBusy] = React.useState<'save' | 'publish' | null>(null);

  React.useEffect(() => {
    setPrice(product?.suggested_price ?? 0);
  }, [product?.suggested_price]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && busy === null) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const validate = (): boolean => {
    if (!accountUnb) return false;
    if (!title.trim()) {
      if (typeof window !== 'undefined') window.alert('请填写闲鱼商品标题');
      return false;
    }
    if (!price || price <= 0) {
      if (typeof window !== 'undefined') window.alert('请填写大于 0 的价格');
      return false;
    }
    return true;
  };

  const buildDraft = (): ListingDraft => {
    const acc = accounts.find((a) => a.accountUnb === accountUnb);
    return {
      product_id: productId,
      account_unb: accountUnb,
      account_label: acc?.nick || acc?.tracknick || accountUnb,
      item_id: '',
      item_title: title.trim(),
      listed_price: price,
      status: 'live',
    };
  };

  const saveDraft = async () => {
    if (!validate()) return;
    setBusy('save');
    try {
      await onSubmit(buildDraft());
    } finally {
      setBusy(null);
    }
  };

  const saveAndPublish = async () => {
    if (!validate()) return;
    if (typeof window !== 'undefined'
      && !window.confirm(`确认保存并立即调闲鱼 API 发布到「${accountLabel(accounts, accountUnb)}」？\n会真的挂出商品。`)) {
      return;
    }
    setBusy('publish');
    try {
      // 先存草稿
      await onSubmit(buildDraft());
      // 再调 publish
      const res = await fetch(nativeActionUrl('goofish', 'publish-product-to-account'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          accountUnb,
          title: title.trim(),
          price,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        itemId?: string;
        itemUrl?: string;
        message?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.message ?? '一键发布失败');
      if (typeof window !== 'undefined') {
        window.alert(`已发到闲鱼 ✓\n商品 ID: ${json.itemId}${json.itemUrl ? `\n链接: ${json.itemUrl}` : ''}`);
      }
      onAfterPublish?.();
    } catch (err) {
      if (typeof window !== 'undefined') {
        const msg = err instanceof Error ? err.message : '一键发布失败';
        window.alert(`${msg}\n\n草稿已保存，你可以在关联商品列表里点「一键发布」重试，或走「复制文案」手动 APP 上架。`);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4"
      onClick={busy === null ? onClose : undefined}
    >
      <div
        className="w-full max-w-md rounded-xl border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold">挂到新账号</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          选个账号 → 确认标题价格 → 任选「保存草稿」或「保存并立即发布」
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">账号</span>
            <select
              value={accountUnb}
              onChange={(e) => setAccountUnb(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              {eligible.length === 0 ? (
                <option value="">（没有可用账号，请先登录闲鱼）</option>
              ) : (
                eligible.map((a) => (
                  <option key={a.accountUnb} value={a.accountUnb}>
                    {a.nick || a.tracknick || a.accountUnb}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">闲鱼商品标题</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">价格（默认用商品挂牌价 ￥{(product?.suggested_price ?? 0).toFixed(2)}）</span>
            <Input
              type="number"
              min={0}
              step={0.1}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value) || 0)}
              className="text-sm"
            />
          </label>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy !== null}>取消</Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void saveDraft()}
            disabled={!accountUnb || busy !== null}
          >
            {busy === 'save' ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            保存草稿
          </Button>
          <Button
            size="sm"
            onClick={() => void saveAndPublish()}
            disabled={!accountUnb || busy !== null}
            title="保存草稿后立即调闲鱼 API 真的挂出商品"
          >
            {busy === 'publish' ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            保存并立即发布
          </Button>
        </div>
      </div>
    </div>
  );
}

function accountLabel(accounts: GoofishAccount[], unb: string): string {
  const acc = accounts.find((a) => a.accountUnb === unb);
  return acc?.nick || acc?.tracknick || unb;
}
