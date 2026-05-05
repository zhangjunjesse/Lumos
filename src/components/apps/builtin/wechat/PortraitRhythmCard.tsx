'use client';

import * as React from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { WEEKDAY_LABELS, type PortraitRhythm } from './portrait-types';

export function PortraitRhythmCard({ rhythm }: { rhythm: PortraitRhythm }): React.ReactElement {
  const max = Math.max(1, ...rhythm.hourly.map((h) => h.count));
  const weeklyMax = Math.max(1, ...rhythm.weekly.map((w) => w.count));
  const todayWeekday = (new Date().getDay() + 6) % 7;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="text-base font-semibold tracking-tight">节奏</CardTitle>
            <CardDescription className="mt-2 max-w-2xl break-words leading-6">
              {rhythm.summary}
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-6 text-right">
            <Stat
              label="最早"
              value={rhythm.earliestHour !== null ? `${String(rhythm.earliestHour).padStart(2, '0')}` : '—'}
              suffix=":00"
            />
            <Stat
              label="最晚"
              value={rhythm.latestHour !== null ? `${String(rhythm.latestHour).padStart(2, '0')}` : '—'}
              suffix=":00"
            />
            <Stat label="活跃" value={String(rhythm.daysActive)} suffix=" 天" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 pt-2">
        <div>
          <div className="mb-2 flex items-baseline justify-between text-[11px] text-muted-foreground">
            <span>24 小时</span>
            <span>
              高峰{' '}
              <span className="text-foreground tabular-nums">
                {String(rhythm.peakHour).padStart(2, '0')}:00
              </span>{' '}
              · {rhythm.peakHourCount} 条
            </span>
          </div>
          <div className="flex h-20 items-end gap-px">
            {rhythm.hourly.map((bar) => (
              <div
                key={bar.hour}
                className={cn(
                  'flex-1 rounded-[2px] transition-colors',
                  bar.count === 0
                    ? 'bg-muted/50'
                    : bar.hour === rhythm.peakHour
                      ? 'bg-foreground'
                      : 'bg-foreground/20 hover:bg-foreground/40',
                )}
                style={{ height: `${Math.max(4, (bar.count / max) * 100)}%` }}
                title={`${String(bar.hour).padStart(2, '0')}:00 · ${bar.count} 条`}
              />
            ))}
          </div>
          <div className="mt-1.5 flex">
            {rhythm.hourly.map((bar) => (
              <span
                key={bar.hour}
                className={cn(
                  'flex-1 text-center text-[9px] tabular-nums text-muted-foreground/60',
                  bar.hour === rhythm.peakHour && 'text-foreground/70',
                )}
              >
                {bar.hour % 6 === 0 ? String(bar.hour).padStart(2, '0') : ''}
              </span>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-[11px] text-muted-foreground">一周</div>
          <div className="flex h-12 items-end gap-1.5">
            {rhythm.weekly.map((bar) => (
              <div
                key={bar.weekday}
                className={cn(
                  'flex-1 rounded-[2px]',
                  bar.weekday === todayWeekday ? 'bg-foreground' : 'bg-foreground/20',
                )}
                style={{ height: `${Math.max(8, (bar.count / weeklyMax) * 100)}%` }}
                title={`${WEEKDAY_LABELS[bar.weekday]} · ${bar.count} 条`}
              />
            ))}
          </div>
          <div className="mt-1.5 flex gap-1.5">
            {rhythm.weekly.map((bar) => (
              <span
                key={bar.weekday}
                className={cn(
                  'flex-1 text-center text-[10px]',
                  bar.weekday === todayWeekday ? 'font-medium text-foreground' : 'text-muted-foreground/70',
                )}
              >
                {WEEKDAY_LABELS[bar.weekday].replace('周', '')}
              </span>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums tracking-tight">
        {value}
        {suffix ? <span className="text-xs font-normal text-muted-foreground">{suffix}</span> : null}
      </p>
    </div>
  );
}
