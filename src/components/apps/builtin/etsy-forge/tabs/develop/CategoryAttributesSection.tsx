'use client';

// 类目与属性子 tab：类目/分区/Who-What-When/类型/续期/生产方/类目属性(随类目变)。
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  attributesForTaxonomy,
  LISTING_TYPE_OPTS,
  RENEWAL_OPTS,
  TAXONOMY_PRESETS,
  WHAT_IS,
  WHEN_MADE,
  WHO_MADE,
} from '@/lib/etsy-forge/listing/catalog';
import type { ListingType, Renewal, WhatIs, WhoMade } from '@/lib/etsy-forge/listing/types';
import type { SectionProps } from './use-listing-editor';

const selectCls = 'mt-1.5 h-8 w-full rounded-md border border-input bg-background px-2 text-sm';

export function CategoryAttributesSection({ listing, patch }: SectionProps) {
  const path = listing.taxonomy_path;
  const details = listing.listing_details;
  const attrDefs = attributesForTaxonomy(path);

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Label>类目</Label>
        <select
          value={path.join(' > ')}
          onChange={(e) => patch({ taxonomy_path: e.target.value ? e.target.value.split(' > ') : [] })}
          className={selectCls}
        >
          <option value="">— 选类目 —</option>
          {TAXONOMY_PRESETS.map((t) => (
            <option key={t.label} value={t.path.join(' > ')}>{t.label}（{t.path.join(' › ')}）</option>
          ))}
          {path.length > 0 && !TAXONOMY_PRESETS.some((t) => t.path.join(' > ') === path.join(' > ')) && (
            <option value={path.join(' > ')}>{path.join(' › ')}（自定义）</option>
          )}
        </select>
        <Input
          value={path.join(' > ')}
          onChange={(e) => patch({ taxonomy_path: e.target.value ? e.target.value.split('>').map((s) => s.trim()).filter(Boolean) : [] })}
          placeholder="或手填，用 > 分隔，如 Clothing > Unisex Adult Clothing > T-shirts"
          className="mt-2 h-8"
        />
      </div>

      <div>
        <Label>店铺分区</Label>
        <Input value={listing.section} onChange={(e) => patch({ section: e.target.value })} placeholder="如 New Arrivals" className="mt-1.5 h-8" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <Label>Who made it</Label>
          <select value={details.whoMade} onChange={(e) => patch({ listing_details: { ...details, whoMade: e.target.value as WhoMade } })} className={selectCls}>
            <option value="">—</option>
            {WHO_MADE.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <Label>What is it</Label>
          <select value={details.whatIs} onChange={(e) => patch({ listing_details: { ...details, whatIs: e.target.value as WhatIs } })} className={selectCls}>
            <option value="">—</option>
            {WHAT_IS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <Label>When made</Label>
          <select value={details.whenMade} onChange={(e) => patch({ listing_details: { ...details, whenMade: e.target.value } })} className={selectCls}>
            <option value="">—</option>
            {WHEN_MADE.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <Label>类型</Label>
          <select value={listing.listing_type} onChange={(e) => patch({ listing_type: e.target.value as ListingType })} className={selectCls}>
            {LISTING_TYPE_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <Label>续期</Label>
          <select value={listing.renewal} onChange={(e) => patch({ renewal: e.target.value as Renewal })} className={selectCls}>
            {RENEWAL_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <Label>生产合作方</Label>
          <Input value={listing.production_partner} onChange={(e) => patch({ production_partner: e.target.value })} placeholder="如 Printful" className="mt-1.5 h-8" />
        </div>
      </div>

      <div>
        <Label>类目属性</Label>
        <div className="mt-1.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {attrDefs.map((def) => {
            const val = listing.attributes[def.key] ?? '';
            const set = (v: string) => patch({ attributes: { ...listing.attributes, [def.key]: v } });
            return (
              <label key={def.key} className="text-sm">
                <span className="text-xs text-muted-foreground">{def.label}</span>
                {def.options ? (
                  <select value={val} onChange={(e) => set(e.target.value)} className={selectCls}>
                    <option value="">—</option>
                    {def.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <Input value={val} onChange={(e) => set(e.target.value)} className="mt-1.5 h-8" />
                )}
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
