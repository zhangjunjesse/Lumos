'use client';

// 通用 chip 输入(标签/材料)。回车/逗号添加；超数量或超字符长度拦截并提示。重复忽略。
import { useState } from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

interface Props {
  values: string[];
  onChange: (v: string[]) => void;
  max: number;
  maxLen?: number; // 单个最大字符数(标签 20)
  placeholder?: string;
}

export function ChipInput({ values, onChange, max, maxLen, placeholder }: Props) {
  const [text, setText] = useState('');
  const [hint, setHint] = useState('');

  const add = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    if (maxLen && v.length > maxLen) return setHint(`单个最多 ${maxLen} 字符`);
    if (values.length >= max) return setHint(`最多 ${max} 个`);
    if (values.includes(v)) return setHint('已存在');
    setHint('');
    onChange([...values, v]);
    setText('');
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v, i) => (
          <Badge key={`${v}-${i}`} variant="secondary" className="gap-1 font-normal">
            {v}
            <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-foreground">
              <X className="size-3" />
            </button>
          </Badge>
        ))}
      </div>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(text);
          }
        }}
        onBlur={() => add(text)}
        placeholder={placeholder ?? `回车添加（最多 ${max} 个）`}
        className="mt-2 h-8"
      />
      <p className="mt-1 text-xs text-muted-foreground">
        {values.length}/{max}
        {hint && <span className="ml-2 text-amber-600">{hint}</span>}
      </p>
    </div>
  );
}
