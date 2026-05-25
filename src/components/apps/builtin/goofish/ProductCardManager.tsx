'use client';

import * as React from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';

import type { CardKind, ProductCard } from './use-products';

const KIND_OPTIONS: Array<{ value: CardKind; label: string; desc: string }> = [
  { value: 'data', label: '卡密池', desc: '一行一码，发完出库（适合软件激活码、账号密码）' },
  { value: 'text', label: '固定文本', desc: '每次都发同样内容（适合教程口令、固定话术）' },
  { value: 'api', label: 'API 取卡', desc: '调外部接口动态取卡（你有自建发卡系统时用）' },
  { value: 'image', label: '图片', desc: '直接发图片消息（适合截图类卡密）' },
];

export function ProductCardManager({
  cards,
  onChange,
}: {
  cards: ProductCard[];
  onChange: (next: ProductCard[]) => void;
}): React.ReactElement {
  const addCard = (kind: CardKind) => {
    const card: ProductCard = {
      id: crypto.randomUUID(),
      kind,
      name: KIND_OPTIONS.find((o) => o.value === kind)?.label ?? '卡密',
      enabled: true,
      delay_seconds: 0,
      ...(kind === 'data' ? { data_lines: [], data_used_count: 0 } : {}),
      ...(kind === 'api' ? { api_config: { url: '', method: 'GET' } } : {}),
    };
    onChange([...cards, card]);
  };

  const patchCard = (id: string, p: Partial<ProductCard>) => {
    onChange(cards.map((c) => (c.id === id ? { ...c, ...p } : c)));
  };

  const removeCard = (id: string) => {
    onChange(cards.filter((c) => c.id !== id));
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          卡密 / 自动发货素材
        </h4>
        <div className="flex flex-wrap gap-1">
          {KIND_OPTIONS.map((o) => (
            <Button
              key={o.value}
              type="button"
              variant="outline"
              size="xs"
              onClick={() => addCard(o.value)}
              title={o.desc}
            >
              <Plus className="size-3" /> {o.label}
            </Button>
          ))}
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="flex h-16 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
          没卡密发货时会回退到上面的「网盘链接」。卡密优先于链接。
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {cards.map((card) => (
            <CardEditor
              key={card.id}
              card={card}
              onPatch={(p) => patchCard(card.id, p)}
              onRemove={() => removeCard(card.id)}
            />
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        发货模板可用 <code>{'{{card}}'}</code> 占位符表示卡密内容；<code>{'{{url}}'}</code>/<code>{'{{code}}'}</code> 表示网盘链接。
      </p>
    </section>
  );
}

function CardEditor({
  card,
  onPatch,
  onRemove,
}: {
  card: ProductCard;
  onPatch: (p: Partial<ProductCard>) => void;
  onRemove: () => void;
}): React.ReactElement {
  const used = card.data_used_count ?? 0;
  const totalLines = (card.data_lines ?? []).length;
  const exhausted = card.kind === 'data' && totalLines > 0 && used >= totalLines;

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
            {KIND_OPTIONS.find((o) => o.value === card.kind)?.label ?? card.kind}
          </span>
          <Input
            value={card.name ?? ''}
            onChange={(e) => onPatch({ name: e.target.value })}
            placeholder="卡密池名称（如：DeepSeek 教程激活码）"
            className="h-7 text-xs"
          />
          {exhausted ? (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-destructive">
              <AlertTriangle className="size-3" /> 已发完
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Switch
            checked={card.enabled !== false}
            onCheckedChange={(v) => onPatch({ enabled: v })}
          />
          <Button type="button" variant="ghost" size="xs" onClick={onRemove}>
            <Trash2 className="size-3" />
          </Button>
        </div>
      </header>

      {card.kind === 'data' ? (
        <DataCardBody card={card} onPatch={onPatch} />
      ) : null}
      {card.kind === 'text' ? (
        <TextCardBody card={card} onPatch={onPatch} />
      ) : null}
      {card.kind === 'image' ? (
        <ImageCardBody card={card} onPatch={onPatch} />
      ) : null}
      {card.kind === 'api' ? (
        <ApiCardBody card={card} onPatch={onPatch} />
      ) : null}
    </div>
  );
}

function DataCardBody({
  card,
  onPatch,
}: {
  card: ProductCard;
  onPatch: (p: Partial<ProductCard>) => void;
}): React.ReactElement {
  const lines = card.data_lines ?? [];
  const used = card.data_used_count ?? 0;
  return (
    <>
      <Label className="text-[10px] text-muted-foreground">
        卡密列表（一行一条，已用 {used} / 总 {lines.length}）
      </Label>
      <Textarea
        value={lines.join('\n')}
        onChange={(e) => onPatch({
          data_lines: e.target.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
        })}
        rows={5}
        placeholder={'每行一条卡密，例如：\nABCD-1234-EFGH\nIJKL-5678-MNOP'}
        className="font-mono text-xs"
      />
      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>下一条会发：{lines[used] ? lines[used].slice(0, 30) + (lines[used].length > 30 ? '…' : '') : '（空）'}</span>
        {used > 0 ? (
          <button
            type="button"
            onClick={() => onPatch({ data_used_count: 0 })}
            className="text-primary hover:underline"
          >重置已用计数</button>
        ) : null}
      </div>
    </>
  );
}

function TextCardBody({
  card,
  onPatch,
}: {
  card: ProductCard;
  onPatch: (p: Partial<ProductCard>) => void;
}): React.ReactElement {
  return (
    <>
      <Label className="text-[10px] text-muted-foreground">每次都发的固定内容</Label>
      <Textarea
        value={card.text_content ?? ''}
        onChange={(e) => onPatch({ text_content: e.target.value })}
        rows={3}
        placeholder="例：「访问 xxx.com/教程 → 输入口令 abc123」"
        className="text-xs"
      />
    </>
  );
}

function ImageCardBody({
  card,
  onPatch,
}: {
  card: ProductCard;
  onPatch: (p: Partial<ProductCard>) => void;
}): React.ReactElement {
  return (
    <>
      <Label className="text-[10px] text-muted-foreground">图片 URL（卡密图）</Label>
      <Input
        value={card.image_url ?? ''}
        onChange={(e) => onPatch({ image_url: e.target.value })}
        placeholder="https://..."
        className="text-xs"
      />
    </>
  );
}

function ApiCardBody({
  card,
  onPatch,
}: {
  card: ProductCard;
  onPatch: (p: Partial<ProductCard>) => void;
}): React.ReactElement {
  const cfg = card.api_config ?? { url: '', method: 'GET' as const };
  const patchCfg = (p: Partial<NonNullable<ProductCard['api_config']>>) => {
    onPatch({ api_config: { ...cfg, ...p } });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[100px_1fr] gap-2">
        <select
          value={cfg.method}
          onChange={(e) => patchCfg({ method: e.target.value as 'GET' | 'POST' })}
          className="h-9 rounded-md border bg-background px-2 text-xs"
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
        </select>
        <Input
          value={cfg.url ?? ''}
          onChange={(e) => patchCfg({ url: e.target.value })}
          placeholder="https://your-card-api.example.com/take?sku=xxx"
          className="text-xs"
        />
      </div>
      <Label className="text-[10px] text-muted-foreground">响应 JSONPath（如 data.code，留空表示直接用响应文本）</Label>
      <Input
        value={cfg.response_jsonpath ?? ''}
        onChange={(e) => patchCfg({ response_jsonpath: e.target.value })}
        placeholder="data.code"
        className="text-xs"
      />
      {cfg.method === 'POST' ? (
        <>
          <Label className="text-[10px] text-muted-foreground">POST body</Label>
          <Textarea
            value={cfg.body_template ?? ''}
            onChange={(e) => patchCfg({ body_template: e.target.value })}
            rows={2}
            placeholder='{"sku": "xxx"}'
            className="font-mono text-xs"
          />
        </>
      ) : null}
    </div>
  );
}
