'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { WorkflowParamDef } from '@/lib/workflow/types';

interface WorkflowParamFormProps {
  params: WorkflowParamDef[];
  values: Record<string, string>;
  errors?: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}

export function WorkflowParamForm({ params, values, errors, onChange }: WorkflowParamFormProps) {
  if (params.length === 0) return null;

  function handleChange(name: string, value: string) {
    onChange({ ...values, [name]: value });
  }

  return (
    <div className="space-y-3">
      {params.map(param => (
        <div key={param.name} className="space-y-1.5">
          <Label className="text-sm">
            {param.description || param.name}
            {param.required && <span className="text-destructive ml-1">*</span>}
            <span className="text-muted-foreground font-normal ml-1.5 text-xs">({param.name})</span>
          </Label>
          <Input
            type={param.type === 'number' ? 'number' : 'text'}
            value={values[param.name] ?? (param.default !== undefined ? String(param.default) : '')}
            onChange={e => handleChange(param.name, e.target.value)}
            placeholder={param.default !== undefined ? `默认: ${param.default}` : `输入 ${param.name}`}
          />
          {errors?.[param.name] && (
            <p className="text-xs text-destructive">{errors[param.name]}</p>
          )}
        </div>
      ))}
    </div>
  );
}
