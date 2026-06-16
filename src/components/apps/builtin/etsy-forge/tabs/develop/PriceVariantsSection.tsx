'use client';

// 价格与变体子 tab：基础价/库存/SKU + 变体矩阵 + 个性化定制。
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { VariationsEditor } from './VariationsEditor';
import type { SectionProps } from './use-listing-editor';

export function PriceVariantsSection({ listing, patch }: SectionProps) {
  const pz = listing.personalization;
  return (
    <div className="max-w-3xl space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <Label>基础价</Label>
          <Input type="number" value={listing.price || ''} onChange={(e) => patch({ price: Number(e.target.value) || 0 })} className="mt-1.5 h-8" />
        </div>
        <div>
          <Label>币种</Label>
          <Input value={listing.currency} onChange={(e) => patch({ currency: e.target.value })} className="mt-1.5 h-8" />
        </div>
        <div>
          <Label>库存</Label>
          <Input type="number" value={listing.quantity || ''} onChange={(e) => patch({ quantity: Number(e.target.value) || 0 })} className="mt-1.5 h-8" />
        </div>
        <div>
          <Label>主 SKU</Label>
          <Input value={listing.sku} onChange={(e) => patch({ sku: e.target.value })} className="mt-1.5 h-8" />
        </div>
      </div>

      <VariationsEditor value={listing.variations} onChange={(variations) => patch({ variations })} />

      <div className="rounded-lg border p-3">
        <div className="flex items-center justify-between">
          <Label>个性化定制</Label>
          <Switch checked={pz.enabled} onCheckedChange={(enabled) => patch({ personalization: { ...pz, enabled } })} />
        </div>
        {pz.enabled && (
          <div className="mt-3 space-y-3">
            <div>
              <Label className="text-xs">给买家的提示语</Label>
              <Textarea value={pz.instructions} onChange={(e) => patch({ personalization: { ...pz, instructions: e.target.value } })} rows={2} className="mt-1" placeholder="如：请填写要印的名字" />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                字数上限
                <Input type="number" value={pz.charLimit} onChange={(e) => patch({ personalization: { ...pz, charLimit: Number(e.target.value) || 0 } })} className="h-8 w-24" />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={pz.optional} onCheckedChange={(optional) => patch({ personalization: { ...pz, optional } })} />
                选填
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
