'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { nativeActionUrl } from './use-goofish-app-data';
import {
  DEFAULT_FULFILLMENT_TEMPLATE,
  type LinkHealth,
  type LinkProvider,
  type ProductLink,
} from './use-products';

const PROVIDER_OPTIONS: Array<{ value: LinkProvider; label: string }> = [
  { value: 'quark', label: '夸克' },
  { value: 'aliyun', label: '阿里云盘' },
  { value: 'baidu', label: '百度' },
  { value: 'lanzou', label: '蓝奏' },
  { value: '115', label: '115' },
  { value: 'other', label: '其他' },
];

export function ProductLinkManager({
  links,
  template,
  productId,
  onChangeLinks,
  onChangeTemplate,
  onUpdateLinkImmediate,
}: {
  links: ProductLink[];
  template: string;
  productId: string | null;
  onChangeLinks: (next: ProductLink[]) => void;
  onChangeTemplate: (template: string) => void;
  onUpdateLinkImmediate?: (next: ProductLink[]) => void;
}): React.ReactElement {
  const addLink = React.useCallback(() => {
    const link: ProductLink = {
      id: crypto.randomUUID(),
      provider: 'quark',
      url: '',
      code: '',
      note: links.length === 0 ? '主链接' : '备用',
      health: 'unchecked',
      last_checked_at: null,
    };
    onChangeLinks([...links, link]);
  }, [links, onChangeLinks]);

  const patch = React.useCallback(
    (id: string, p: Partial<ProductLink>) => {
      onChangeLinks(links.map((l) => (l.id === id ? { ...l, ...p } : l)));
    },
    [links, onChangeLinks],
  );

  const remove = React.useCallback(
    (id: string) => {
      onChangeLinks(links.filter((l) => l.id !== id));
    },
    [links, onChangeLinks],
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          网盘链接
        </h4>
        <Button type="button" variant="outline" size="sm" onClick={addLink}>
          <Plus className="size-3.5" /> 添加链接
        </Button>
      </div>

      {links.length === 0 ? (
        <div className="flex h-20 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
          至少添加一条夸克 / 阿里 / 百度网盘链接
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {links.map((link, idx) => (
            <LinkCard
              key={link.id}
              link={link}
              isFirst={idx === 0}
              hasReport={Boolean(productId)}
              onPatch={(p) => patch(link.id, p)}
              onTested={(healthPatch) => {
                const next = links.map((l) => (l.id === link.id ? { ...l, ...healthPatch } : l));
                if (onUpdateLinkImmediate) onUpdateLinkImmediate(next);
                else onChangeLinks(next);
              }}
              onRemove={() => remove(link.id)}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="ful-template" className="text-xs">发货话术模板</Label>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onChangeTemplate(DEFAULT_FULFILLMENT_TEMPLATE)}
          >
            恢复默认
          </Button>
        </div>
        <Textarea
          id="ful-template"
          value={template}
          onChange={(e) => onChangeTemplate(e.target.value)}
          rows={4}
          className="text-xs"
          placeholder="支持 {{url}} {{code}} {{title}} {{buyer}} 占位符"
        />
        <p className="text-[10px] text-muted-foreground">
          占位符：<code>{'{{url}}'}</code> 链接 / <code>{'{{code}}'}</code> 提取码 /
          <code>{'{{title}}'}</code> 商品标题 / <code>{'{{buyer}}'}</code> 买家昵称
        </p>
      </div>
    </section>
  );
}

function LinkCard({
  link,
  isFirst,
  hasReport,
  onPatch,
  onTested,
  onRemove,
}: {
  link: ProductLink;
  isFirst: boolean;
  hasReport: boolean;
  onPatch: (p: Partial<ProductLink>) => void;
  onTested: (healthPatch: { health: LinkHealth; last_checked_at: string }) => void;
  onRemove: () => void;
}): React.ReactElement {
  const [checking, setChecking] = React.useState(false);
  const test = async () => {
    if (!link.url.trim()) return;
    setChecking(true);
    try {
      const res = await fetch(nativeActionUrl('goofish', 'check-product-link'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: link.provider, url: link.url }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        health?: LinkHealth;
        message?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.message ?? '检测失败');
      onTested({
        health: json.health ?? 'unchecked',
        last_checked_at: new Date().toISOString(),
      });
      if (!hasReport && typeof window !== 'undefined') {
        // Editor is brand-new (not yet saved) → test result lives only in draft;
        // remind user it needs a save to persist.
        // intentionally no alert here, the warning badge in UI is enough.
      }
    } catch (err) {
      if (typeof window !== 'undefined') {
        window.alert(err instanceof Error ? err.message : '链接检测失败');
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-3',
        link.health === 'broken' && 'border-destructive/50 bg-destructive/5',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <select
            value={link.provider}
            onChange={(e) => onPatch({
              provider: e.target.value as LinkProvider,
              health: 'unchecked',
              last_checked_at: null,
            })}
            className="h-7 rounded-md border bg-background px-2 text-xs"
          >
            {PROVIDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {isFirst ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">主链接</span>
          ) : null}
          <HealthBadge health={link.health} lastCheckedAt={link.last_checked_at} />
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={test}
            disabled={checking || !link.url.trim()}
          >
            {checking ? <Loader2 className="size-3 animate-spin" /> : null}
            测一下
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={onRemove}>
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Input
          value={link.url}
          onChange={(e) => onPatch({ url: e.target.value, health: 'unchecked' })}
          placeholder="https://pan.quark.cn/s/xxxxxx"
          className="text-xs"
        />
        <Input
          value={link.code}
          onChange={(e) => onPatch({ code: e.target.value })}
          placeholder="提取码"
          className="w-24 text-xs"
        />
      </div>
      <Input
        value={link.note}
        onChange={(e) => onPatch({ note: e.target.value })}
        placeholder="备注（主/备用/v2 等）"
        className="text-xs"
      />
    </div>
  );
}

function HealthBadge({
  health,
  lastCheckedAt,
}: {
  health: LinkHealth;
  lastCheckedAt: string | null;
}): React.ReactElement {
  if (health === 'ok') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-3" />
        有效 {relativeTime(lastCheckedAt)}
      </span>
    );
  }
  if (health === 'broken') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-destructive">
        <AlertTriangle className="size-3" />
        失效 {relativeTime(lastCheckedAt)}
      </span>
    );
  }
  return <span className="text-[10px] text-muted-foreground">未检测</span>;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}小时前`;
  return `${Math.floor(hr / 24)}天前`;
}
