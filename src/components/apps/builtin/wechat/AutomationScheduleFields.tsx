'use client';

import * as React from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import type { AutomationKind } from './relations-types';
import {
  type RecurringScheduleMode,
  WEEKDAY_OPTIONS,
  buildRecurringPatch,
  datetimeLocalValue,
  parseDatetimeLocal,
  parseRecurringScheduleConfig,
  parseTimeParts,
} from './automation-schedule-form';

export interface AutomationScheduleValue {
  kind: AutomationKind;
  onceAt: number;
  cron: string;
  cronLabel: string;
}

export function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/**
 * 一次性 → datetime-local；周期 → 频率可视化编辑器。统一吐
 * { onceAt } 或 { cron, cronLabel } 补丁，create/edit 共用，彻底解开
 * 旧版「建完即一次性、永远进不去周期编辑器」的死锁。
 */
export function AutomationScheduleFields({
  value,
  minOnceAt,
  onChange,
}: {
  value: AutomationScheduleValue;
  minOnceAt: string;
  onChange: (patch: Partial<AutomationScheduleValue>) => void;
}): React.ReactElement {
  if (value.kind === 'reminder_once') {
    return (
      <Field label="执行时间">
        <Input
          type="datetime-local"
          value={datetimeLocalValue(value.onceAt)}
          min={minOnceAt}
          onChange={(e) => {
            const next = parseDatetimeLocal(e.target.value);
            if (next) onChange({ onceAt: next });
          }}
        />
      </Field>
    );
  }
  return <RecurringScheduleEditor value={value} onChange={onChange} />;
}

function RecurringScheduleEditor({
  value,
  onChange,
}: {
  value: AutomationScheduleValue;
  onChange: (patch: Partial<AutomationScheduleValue>) => void;
}) {
  const config = parseRecurringScheduleConfig(value.cron);
  const applyMode = (mode: RecurringScheduleMode) => {
    onChange(buildRecurringPatch({ ...config, mode }));
  };
  const applyTime = (time: string) => {
    if (!parseTimeParts(time) || (config.mode !== 'daily' && config.mode !== 'weekly')) return;
    onChange(buildRecurringPatch({ ...config, time }));
  };
  const applyWeekday = (weekday: string) => {
    if (config.mode !== 'weekly') return;
    onChange(buildRecurringPatch({ ...config, weekday }));
  };
  const applyIntervalHours = (raw: string) => {
    const intervalHours = Math.max(1, Math.min(24, Number(raw) || 1));
    onChange(buildRecurringPatch({ ...config, mode: 'hourly', intervalHours }));
  };
  const applyIntervalMinutes = (raw: string) => {
    const intervalMinutes = Math.max(1, Math.min(59, Number(raw) || 1));
    onChange(buildRecurringPatch({ ...config, mode: 'minutely', intervalMinutes }));
  };

  return (
    <>
      <Field label="重复频率">
        <Select value={config.mode} onValueChange={(v) => applyMode(v as RecurringScheduleMode)}>
          <SelectTrigger className="h-9 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="daily">每天</SelectItem>
              <SelectItem value="weekly">每周</SelectItem>
              <SelectItem value="hourly">每 N 小时</SelectItem>
              <SelectItem value="minutely">每 N 分钟</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      {config.mode === 'daily' || config.mode === 'weekly' ? (
        <Field label="执行时间">
          <Input
            type="time"
            value={config.time}
            onChange={(e) => applyTime(e.target.value)}
            className="tabular-nums"
          />
        </Field>
      ) : null}

      {config.mode === 'weekly' ? (
        <Field label="星期">
          <Select value={config.weekday} onValueChange={applyWeekday}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {WEEKDAY_OPTIONS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {config.mode === 'hourly' ? (
        <Field label="间隔小时">
          <Input
            type="number"
            min={1}
            max={24}
            value={config.intervalHours}
            onChange={(e) => applyIntervalHours(e.target.value)}
            className="tabular-nums"
          />
        </Field>
      ) : null}

      {config.mode === 'minutely' ? (
        <Field label="间隔分钟">
          <Input
            type="number"
            min={1}
            max={59}
            value={config.intervalMinutes}
            onChange={(e) => applyIntervalMinutes(e.target.value)}
            className="tabular-nums"
          />
        </Field>
      ) : null}

      <div className="flex items-center rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground sm:col-span-2">
        将保存为：{value.cronLabel}
      </div>
    </>
  );
}
