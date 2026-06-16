'use client';

// 导出/上架子 tab：完整度门禁(标记待上架) + 逐字段复制 + 导出 JSON·CSV + 标记已上架(填 Etsy 链接)。
// 不调用任何 Etsy 写接口、不自动发布(R3)。
import { useState } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { computeCompleteness } from '@/lib/etsy-forge/listing/completeness';
import { downloadText, toCsv, toEtsyObject } from './listing-export';
import type { SectionProps } from './use-listing-editor';

function CopyBtn({ label, text, copied, onCopy }: { label: string; text: string; copied: string; onCopy: (l: string, t: string) => void }) {
  return (
    <Button size="sm" variant="outline" className="h-7 justify-start gap-1.5" onClick={() => onCopy(label, text)} disabled={!text}>
      <Copy className="size-3" />复制{label}{copied === label && <span className="text-emerald-600">✓</span>}
    </Button>
  );
}

export function ExportSection({ listing, patch, flush }: SectionProps) {
  const c = computeCompleteness(listing);
  const [copied, setCopied] = useState('');
  const copy = (label: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(''), 1500);
    });
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">待上架门禁</p>
            <p className="text-xs text-muted-foreground">必填项齐了才能标记「待上架」</p>
          </div>
          <Button
            size="sm"
            disabled={!c.canMarkReady || listing.status === 'ready'}
            onClick={() => {
              patch({ status: 'ready' });
              void flush();
            }}
          >
            {listing.status === 'ready' ? '已待上架' : '标记待上架'}
          </Button>
        </div>
        {!c.canMarkReady && (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-destructive">
            {c.missing.map((m) => <li key={m.key}>缺：{m.label}</li>)}
          </ul>
        )}
      </div>

      <div>
        <Label>逐字段复制</Label>
        <div className="mt-2 flex flex-wrap gap-2">
          <CopyBtn label="标题" text={listing.title} copied={copied} onCopy={copy} />
          <CopyBtn label="描述" text={listing.description} copied={copied} onCopy={copy} />
          <CopyBtn label="标签" text={listing.tags.join(', ')} copied={copied} onCopy={copy} />
          <CopyBtn label="材料" text={listing.materials.join(', ')} copied={copied} onCopy={copy} />
        </div>
      </div>

      <div>
        <Label>整条导出</Label>
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => downloadText(`${listing.internal_name || 'listing'}.json`, JSON.stringify(toEtsyObject(listing), null, 2), 'application/json')}>
            导出 JSON
          </Button>
          <Button size="sm" variant="outline" onClick={() => downloadText(`${listing.internal_name || 'listing'}.csv`, toCsv(listing), 'text/csv')}>
            导出 CSV
          </Button>
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <p className="text-sm font-medium">手动上架后回填</p>
        <p className="text-xs text-muted-foreground">在 Etsy 手动上架完，把链接填这，标记为已上架。本应用不替你上架。</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input value={listing.etsy_listing_url ?? ''} onChange={(e) => patch({ etsy_listing_url: e.target.value })} placeholder="Etsy listing 链接" className="h-8" />
          <Input value={listing.etsy_listing_id ?? ''} onChange={(e) => patch({ etsy_listing_id: e.target.value })} placeholder="listing ID（可选）" className="h-8" />
        </div>
        <Button
          size="sm"
          className="mt-3"
          disabled={!listing.etsy_listing_url || listing.status === 'listed'}
          onClick={() => {
            patch({ status: 'listed' });
            void flush();
          }}
        >
          {listing.status === 'listed' ? '已标记上架' : '标记已上架'}
        </Button>
      </div>
    </div>
  );
}
