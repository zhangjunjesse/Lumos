'use client';

// 文案子 tab：标题(字数计数)/描述/标签/材料 + AI 草稿。
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LISTING_LIMITS } from '@/lib/etsy-forge/listing/types';
import { ChipInput } from './ChipInput';
import { AiDraftPanel } from './AiDraftPanel';
import type { SectionProps } from './use-listing-editor';

export function CopySection({ listing, patch }: SectionProps) {
  const titleOver = listing.title.length > LISTING_LIMITS.TITLE;
  return (
    <div className="max-w-3xl space-y-5">
      <AiDraftPanel listing={listing} patch={patch} />

      <div>
        <div className="flex items-center justify-between">
          <Label>标题</Label>
          <span className={`text-xs ${titleOver ? 'text-destructive' : 'text-muted-foreground'}`}>
            {listing.title.length}/{LISTING_LIMITS.TITLE}
          </span>
        </div>
        <Input
          value={listing.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="含核心关键词的 Etsy 标题"
          className="mt-1.5"
        />
      </div>

      <div>
        <Label>描述</Label>
        <Textarea
          value={listing.description}
          onChange={(e) => patch({ description: e.target.value })}
          placeholder="卖点 / 材质 / 尺码提示 / 适用场景 / 发货说明"
          rows={10}
          className="mt-1.5"
        />
      </div>

      <div>
        <Label>标签（Tags）</Label>
        <div className="mt-1.5">
          <ChipInput
            values={listing.tags}
            onChange={(tags) => patch({ tags })}
            max={LISTING_LIMITS.TAGS}
            maxLen={LISTING_LIMITS.TAG_LEN}
            placeholder="长尾 SEO 短语，回车添加"
          />
        </div>
      </div>

      <div>
        <Label>材料（Materials）</Label>
        <div className="mt-1.5">
          <ChipInput values={listing.materials} onChange={(materials) => patch({ materials })} max={LISTING_LIMITS.MATERIALS} placeholder="面料/材质，回车添加" />
        </div>
      </div>
    </div>
  );
}
