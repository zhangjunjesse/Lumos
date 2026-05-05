'use client';

import * as React from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import {
  formatMinutesShort,
  type PortraitRelationships,
  type PortraitResponsiveness,
  type ResponseEntry,
  type RisingContact,
  type SilentContact,
} from './portrait-types';

export function PortraitRelationsCard({ data }: { data: PortraitRelationships }): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold tracking-tight">关系雷达</CardTitle>
        <CardDescription className="break-words">{data.summary}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 pt-2">
        <RelationGroup label="升温" items={data.rising} variant="rising" />
        <RelationGroup label="降温" items={data.fading} variant="fading" />
        <SilentGroup items={data.silent} />
      </CardContent>
    </Card>
  );
}

function RelationGroup({
  label,
  items,
  variant,
}: {
  label: string;
  items: RisingContact[];
  variant: 'rising' | 'fading';
}) {
  const arrow = variant === 'rising' ? '▲' : '▼';
  const arrowColor = variant === 'rising' ? 'text-emerald-600' : 'text-rose-600';
  return (
    <div>
      <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <div className="flex flex-col">
          {items.map((item) => (
            <div
              key={item.wxid}
              className="flex items-baseline justify-between gap-3 py-2 [&:not(:first-child)]:border-t"
            >
              <span className="min-w-0 truncate text-sm">
                {item.isGroup ? '· ' : ''}
                {item.display}
              </span>
              <span className="flex shrink-0 items-baseline gap-2 text-xs tabular-nums">
                <span className="text-muted-foreground">
                  {item.previous} → {item.recent}
                </span>
                <span className={cn('text-sm font-medium', arrowColor)}>
                  {arrow} {Math.abs(item.delta)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SilentGroup({ items }: { items: SilentContact[] }) {
  return (
    <div>
      <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">沉默</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <div className="flex flex-col">
          {items.map((item) => (
            <div
              key={item.wxid}
              className="flex items-baseline justify-between gap-3 py-2 [&:not(:first-child)]:border-t"
            >
              <span className="min-w-0 truncate text-sm">{item.display}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {item.daysSinceLast} 天
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PortraitResponseCard({ data }: { data: PortraitResponsiveness }): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold tracking-tight">响应力</CardTitle>
        <CardDescription className="break-words">{data.summary}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 pt-2">
        <div className="grid grid-cols-2 gap-6">
          <BigStat
            label="你回别人"
            minutes={data.yourMedianMinutes}
            sample={data.yourSampleSize}
          />
          <BigStat
            label="别人回你"
            minutes={data.theirMedianMinutes}
            sample={data.theirSampleSize}
          />
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <ResponseList label="回你最快" items={data.fastestForYou} />
          <ResponseList label="回你最慢" items={data.slowestForYou} />
        </div>
      </CardContent>
    </Card>
  );
}

function BigStat({
  label,
  minutes,
  sample,
}: {
  label: string;
  minutes: number | null;
  sample: number;
}) {
  const formatted = minutes === null ? null : splitMinutes(minutes);
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 text-4xl font-semibold tabular-nums tracking-tight">
        {formatted ? (
          <>
            {formatted.value}
            <span className="ml-1 text-base font-normal text-muted-foreground">
              {formatted.unit}
            </span>
          </>
        ) : (
          '—'
        )}
      </p>
      <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">{sample} 次往返</p>
    </div>
  );
}

function ResponseList({ label, items }: { label: string; items: ResponseEntry[] }) {
  return (
    <div>
      <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <div className="flex flex-col">
          {items.map((item) => (
            <div
              key={item.wxid}
              className="flex items-baseline justify-between gap-3 py-2 [&:not(:first-child)]:border-t"
            >
              <span className="min-w-0 truncate text-sm">{item.display}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {formatMinutesShort(item.medianMinutes)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function splitMinutes(value: number): { value: string; unit: string } {
  if (value < 1) return { value: '<1', unit: '分钟' };
  if (value < 60) return { value: String(Math.round(value)), unit: '分钟' };
  if (value < 60 * 12) return { value: (value / 60).toFixed(1), unit: '小时' };
  return { value: (value / (60 * 24)).toFixed(1), unit: '天' };
}
