'use client';

// 产品开发 — 详情壳：顶栏(返回/产品名/保存态) + 7 子 tab。编辑走 useListingEditor 防抖落库。
import { useState, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { STATUS_LABELS } from '@/lib/etsy-forge/listing/catalog';
import type { ListingRow } from './listing-api';
import { useListingEditor, type SectionProps } from './use-listing-editor';
import { OverviewSection } from './OverviewSection';
import { CopySection } from './CopySection';
import { PhotosSection } from './PhotosSection';
import { PriceVariantsSection } from './PriceVariantsSection';
import { CategoryAttributesSection } from './CategoryAttributesSection';
import { ShippingSection } from './ShippingSection';
import { ExportSection } from './ExportSection';

const SUBTABS: { value: string; label: string; render: (p: SectionProps) => ReactNode }[] = [
  { value: 'overview', label: '概览', render: (p) => <OverviewSection {...p} /> },
  { value: 'copy', label: '文案', render: (p) => <CopySection {...p} /> },
  { value: 'photos', label: '图片', render: (p) => <PhotosSection {...p} /> },
  { value: 'price', label: '价格与变体', render: (p) => <PriceVariantsSection {...p} /> },
  { value: 'category', label: '类目与属性', render: (p) => <CategoryAttributesSection {...p} /> },
  { value: 'shipping', label: '物流', render: (p) => <ShippingSection {...p} /> },
  { value: 'export', label: '导出', render: (p) => <ExportSection {...p} /> },
];

export function ListingDetail({ initial, onBack }: { initial: ListingRow; onBack: (changed: boolean) => void }) {
  const { listing, patch, flush, saving, error } = useListingEditor(initial);
  const [sub, setSub] = useState('overview');
  const sectionProps: SectionProps = { listing, patch, flush };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => void flush().then(() => onBack(true))} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />返回列表
        </button>
        <input
          value={listing.internal_name}
          onChange={(e) => patch({ internal_name: e.target.value })}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-lg font-semibold hover:border-input focus:border-input focus:outline-none"
        />
        <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{STATUS_LABELS[listing.status]}</span>
        <span className="text-xs text-muted-foreground">{saving ? '保存中…' : '已保存'}</span>
      </div>
      {error && <p className="text-xs text-destructive">保存失败：{error}</p>}

      <Tabs value={sub} onValueChange={setSub}>
        <TabsList className="flex-wrap">
          {SUBTABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
        {SUBTABS.map((t) => (
          <TabsContent key={t.value} value={t.value} className="mt-4">
            {t.render(sectionProps)}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
