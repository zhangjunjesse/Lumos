'use client';

// 概览子 tab：主图 + 状态 + 完整度清单(缺哪些必填一眼可见) + 来源 + 备注。
import { Check, X } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { STATUS_LABELS } from '@/lib/etsy-forge/listing/catalog';
import { computeCompleteness } from '@/lib/etsy-forge/listing/completeness';
import type { ListingStatus } from '@/lib/etsy-forge/listing/types';
import type { SectionProps } from './use-listing-editor';

const SOURCE_LABELS: Record<string, string> = { blank: '空白新建', from_group: '从出图组导入', from_collected: '从采集商品' };

export function OverviewSection({ listing, patch, flush }: SectionProps) {
  const c = computeCompleteness(listing);
  const main = (listing.photos || []).find((p) => p.isMain) || (listing.photos || [])[0] || null;

  return (
    <div className="grid max-w-4xl gap-6 sm:grid-cols-[200px_1fr]">
      <div>
        {main ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={main.src} alt="主图" className="aspect-square w-full rounded-lg border object-cover" />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">未设主图</div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">来源：{SOURCE_LABELS[listing.source_kind] ?? listing.source_kind}</p>
      </div>

      <div className="space-y-5">
        <div>
          <Label>状态</Label>
          <select
            value={listing.status}
            onChange={(e) => {
              patch({ status: e.target.value as ListingStatus });
              void flush();
            }}
            className="mt-1.5 h-8 w-48 rounded-md border border-input bg-background px-2 text-sm"
          >
            {(['draft', 'developing', 'ready', 'listed', 'archived'] as ListingStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <Label>完整度</Label>
            <span className="text-sm font-medium">{c.percent}%</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-emerald-500" style={{ width: `${c.percent}%` }} />
          </div>
          <ul className="mt-3 space-y-1 text-sm">
            {c.missing.length === 0 ? (
              <li className="flex items-center gap-2 text-emerald-600"><Check className="size-4" />必填项已齐，可在「导出」标记待上架</li>
            ) : (
              c.missing.map((m) => (
                <li key={m.key} className="flex items-center gap-2 text-muted-foreground"><X className="size-4 text-destructive" />缺：{m.label}</li>
              ))
            )}
            {c.recommended.map((r) => (
              <li key={r.key} className="flex items-center gap-2 text-amber-600/80"><span className="size-4 text-center text-xs">·</span>建议补全：{r.label}</li>
            ))}
          </ul>
        </div>

        <div>
          <Label>备注</Label>
          <Textarea value={listing.note} onChange={(e) => patch({ note: e.target.value })} rows={3} className="mt-1.5" placeholder="给自己的开发备注" />
        </div>
      </div>
    </div>
  );
}
