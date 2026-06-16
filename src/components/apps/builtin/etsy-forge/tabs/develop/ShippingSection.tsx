'use client';

// 物流子 tab：物流模板名/加工时间/原产国/重量尺寸/退换政策。
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { ShippingInfo } from '@/lib/etsy-forge/listing/types';
import type { SectionProps } from './use-listing-editor';

export function ShippingSection({ listing, patch }: SectionProps) {
  const s = listing.shipping;
  const set = (p: Partial<ShippingInfo>) => patch({ shipping: { ...s, ...p } });

  return (
    <div className="max-w-3xl space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <Label>物流模板名</Label>
          <Input value={s.profileName} onChange={(e) => set({ profileName: e.target.value })} placeholder="Etsy 里的运费模板名" className="mt-1.5 h-8" />
        </div>
        <div>
          <Label>加工时间</Label>
          <Input value={s.processingTime} onChange={(e) => set({ processingTime: e.target.value })} placeholder="如 1-3 business days" className="mt-1.5 h-8" />
        </div>
        <div>
          <Label>原产国</Label>
          <Input value={s.countryOfOrigin} onChange={(e) => set({ countryOfOrigin: e.target.value })} placeholder="如 United States" className="mt-1.5 h-8" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <Label>重量</Label>
          <div className="mt-1.5 flex gap-1">
            <Input type="number" value={s.weight.value || ''} onChange={(e) => set({ weight: { ...s.weight, value: Number(e.target.value) || 0 } })} className="h-8" />
            <select value={s.weight.unit} onChange={(e) => set({ weight: { ...s.weight, unit: e.target.value as ShippingInfo['weight']['unit'] } })} className="h-8 rounded-md border border-input bg-background px-1 text-sm">
              <option value="oz">oz</option><option value="g">g</option><option value="lb">lb</option><option value="kg">kg</option>
            </select>
          </div>
        </div>
        <div className="col-span-2">
          <Label>尺寸（长 × 宽 × 高）</Label>
          <div className="mt-1.5 flex items-center gap-1">
            <Input type="number" value={s.dimensions.l || ''} onChange={(e) => set({ dimensions: { ...s.dimensions, l: Number(e.target.value) || 0 } })} className="h-8" />
            <span>×</span>
            <Input type="number" value={s.dimensions.w || ''} onChange={(e) => set({ dimensions: { ...s.dimensions, w: Number(e.target.value) || 0 } })} className="h-8" />
            <span>×</span>
            <Input type="number" value={s.dimensions.h || ''} onChange={(e) => set({ dimensions: { ...s.dimensions, h: Number(e.target.value) || 0 } })} className="h-8" />
            <select value={s.dimensions.unit} onChange={(e) => set({ dimensions: { ...s.dimensions, unit: e.target.value as ShippingInfo['dimensions']['unit'] } })} className="h-8 rounded-md border border-input bg-background px-1 text-sm">
              <option value="in">in</option><option value="cm">cm</option>
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-lg border p-3">
        <div className="flex items-center justify-between">
          <Label>接受退换</Label>
          <Switch checked={s.returnsAccepted} onCheckedChange={(returnsAccepted) => set({ returnsAccepted })} />
        </div>
        {s.returnsAccepted && (
          <label className="mt-3 flex items-center gap-2 text-sm">
            退换窗口(天)
            <Input type="number" value={s.returnWindowDays || ''} onChange={(e) => set({ returnWindowDays: Number(e.target.value) || 0 })} className="h-8 w-24" />
          </label>
        )}
      </div>
    </div>
  );
}
