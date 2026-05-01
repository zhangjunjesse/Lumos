"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { IMConfigField } from "@/lib/im";

/**
 * 通用 JSON Schema → 表单。
 * 所有 IM provider 的配置 UI 都过这个组件，没有 per-provider 自定义渲染。
 * 加配置字段 = 改 manifest，UI 自动更新。
 */
export interface SchemaFormProps {
  fields: IMConfigField[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  disabled?: boolean;
}

export function SchemaForm({ fields, values, onChange, disabled }: SchemaFormProps) {
  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <FormField
          key={field.key}
          field={field}
          value={values[field.key] ?? ""}
          onChange={(v) => onChange(field.key, v)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

interface FormFieldProps {
  field: IMConfigField;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

function FormField({ field, value, onChange, disabled }: FormFieldProps) {
  const id = `im-field-${field.key}`;

  if (field.type === "boolean") {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <Label htmlFor={id} className="text-sm font-medium">
            {field.label}
            {field.required && <span className="ml-1 text-destructive">*</span>}
          </Label>
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}
        </div>
        <Switch
          id={id}
          checked={value === "true"}
          onCheckedChange={(checked) => onChange(checked ? "true" : "false")}
          disabled={disabled}
        />
      </div>
    );
  }

  if (field.type === "enum") {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {field.label}
          {field.required && <span className="ml-1 text-destructive">*</span>}
        </Label>
        <Select value={value || String(field.default ?? "")} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger id={id}>
            <SelectValue placeholder={field.placeholder} />
          </SelectTrigger>
          <SelectContent>
            {(field.enumValues ?? []).map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {field.description && (
          <p className="text-xs text-muted-foreground">{field.description}</p>
        )}
      </div>
    );
  }

  // string / secret / url / number
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {field.label}
        {field.required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      <Input
        id={id}
        type={field.type === "secret" ? "password" : field.type === "number" ? "number" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        disabled={disabled}
        autoComplete={field.type === "secret" ? "new-password" : "off"}
      />
      {field.description && (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      )}
    </div>
  );
}
