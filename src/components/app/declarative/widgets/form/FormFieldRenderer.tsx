'use client';

import * as React from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

interface FormField {
  type: string;
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  description?: string;
  default?: unknown;
  rows?: number;
  options?: Array<string | { value: string | number | boolean; label: string }>;
  accept?: string;
  multiple?: boolean;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  pattern?: string;
}

export function FormFieldRenderer({
  field,
  value,
  onChange,
}: {
  field: Record<string, unknown>;
  value: unknown;
  onChange: (v: unknown) => void;
}): React.ReactElement {
  const f = field as unknown as FormField;
  const labelEl = (
    <Label htmlFor={f.name} className="flex items-center gap-1">
      {f.label}
      {f.required ? <span className="text-destructive">*</span> : null}
    </Label>
  );
  const desc = f.description ? (
    <p className="text-xs text-muted-foreground">{f.description}</p>
  ) : null;

  const wrapper = (input: React.ReactNode) => (
    <div className="flex flex-col gap-1.5">
      {labelEl}
      {input}
      {desc}
    </div>
  );

  switch (f.type) {
    case 'text':
      return wrapper(
        <Input
          id={f.name}
          type="text"
          value={(value as string | undefined) ?? ''}
          placeholder={f.placeholder}
          maxLength={f.maxLength}
          pattern={f.pattern}
          required={f.required}
          onChange={(e) => onChange(e.target.value)}
        />,
      );

    case 'textarea':
      return wrapper(
        <Textarea
          id={f.name}
          rows={f.rows ?? 4}
          value={(value as string | undefined) ?? ''}
          placeholder={f.placeholder}
          required={f.required}
          onChange={(e) => onChange(e.target.value)}
        />,
      );

    case 'number':
      return wrapper(
        <Input
          id={f.name}
          type="number"
          value={(value as number | undefined)?.toString() ?? ''}
          placeholder={f.placeholder}
          min={f.min}
          max={f.max}
          step={f.step}
          required={f.required}
          onChange={(e) => {
            const n = e.target.value === '' ? undefined : Number(e.target.value);
            onChange(n);
          }}
        />,
      );

    case 'select':
      return wrapper(
        <Select
          value={(value as string | undefined) ?? ''}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger id={f.name}>
            <SelectValue placeholder={f.placeholder ?? '请选择'} />
          </SelectTrigger>
          <SelectContent>
            {(f.options ?? []).map((opt) => {
              const optVal = typeof opt === 'string' ? opt : String(opt.value);
              const optLabel = typeof opt === 'string' ? opt : opt.label;
              return (
                <SelectItem key={optVal} value={optVal}>
                  {optLabel}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>,
      );

    case 'checkbox':
      return (
        <div className="flex items-center gap-2">
          <Checkbox
            id={f.name}
            checked={Boolean(value)}
            onCheckedChange={(v) => onChange(Boolean(v))}
          />
          <Label htmlFor={f.name}>{f.label}</Label>
          {desc}
        </div>
      );

    case 'switch':
      return (
        <div className="flex items-center gap-2">
          <Switch
            id={f.name}
            checked={Boolean(value)}
            onCheckedChange={(v) => onChange(v)}
          />
          <Label htmlFor={f.name}>{f.label}</Label>
          {desc}
        </div>
      );

    case 'file':
      return wrapper(
        <Input
          id={f.name}
          type="file"
          accept={f.accept}
          multiple={f.multiple}
          required={f.required}
          onChange={(e) => {
            const files = e.target.files;
            if (!files) {
              onChange(undefined);
              return;
            }
            onChange(f.multiple ? Array.from(files) : files[0]);
          }}
        />,
      );

    default:
      return (
        <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          Unknown field type: <code>{f.type}</code>
        </div>
      );
  }
}
