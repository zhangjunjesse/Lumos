'use client';

// 变体编辑：加属性(尺码/颜色/自定义)→ 每属性选项(ChipInput)→ 自动生成组合表，每组合可单独价/库存/SKU。
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { COLOR_PRESET, SIZE_PRESET } from '@/lib/etsy-forge/listing/catalog';
import type { VariationProperty, Variations } from '@/lib/etsy-forge/listing/types';
import { ChipInput } from './ChipInput';
import { rebuildCombos } from './variations';

export function VariationsEditor({ value, onChange }: { value: Variations; onChange: (v: Variations) => void }) {
  const props = value.properties;
  const sync = (properties: VariationProperty[]) => onChange({ properties, combos: rebuildCombos({ properties, combos: value.combos }) });

  const addProp = (p: VariationProperty) => {
    if (props.some((x) => x.name.toLowerCase() === p.name.toLowerCase())) return;
    sync([...props, p]);
  };
  const updateProp = (i: number, patch: Partial<VariationProperty>) => sync(props.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const removeProp = (i: number) => sync(props.filter((_, j) => j !== i));
  const setCombo = (key: string, patch: Partial<{ price: number; quantity: number; sku: string }>) =>
    onChange({ ...value, combos: value.combos.map((c) => (c.key === key ? { ...c, ...patch } : c)) });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">变体</span>
        <Button size="sm" variant="outline" className="h-7" onClick={() => addProp({ name: 'Size', options: SIZE_PRESET })}>＋尺码</Button>
        <Button size="sm" variant="outline" className="h-7" onClick={() => addProp({ name: 'Color', options: COLOR_PRESET })}>＋颜色</Button>
        <Button size="sm" variant="outline" className="h-7" onClick={() => addProp({ name: '', options: [] })}><Plus className="size-3" />自定义</Button>
      </div>

      {props.map((p, i) => (
        <div key={i} className="rounded-lg border p-3">
          <div className="mb-2 flex items-center gap-2">
            <Input value={p.name} onChange={(e) => updateProp(i, { name: e.target.value })} placeholder="属性名(如 Size)" className="h-8 max-w-[200px]" />
            <button type="button" onClick={() => removeProp(i)} className="text-destructive hover:text-destructive/80"><Trash2 className="size-4" /></button>
          </div>
          <ChipInput values={p.options} onChange={(options) => updateProp(i, { options })} max={50} placeholder="选项值，回车添加" />
        </div>
      ))}

      {value.combos.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">组合</th>
                <th className="px-3 py-2 text-left">价格(空=基础价)</th>
                <th className="px-3 py-2 text-left">库存</th>
                <th className="px-3 py-2 text-left">SKU</th>
              </tr>
            </thead>
            <tbody>
              {value.combos.map((c) => (
                <tr key={c.key} className="border-t">
                  <td className="px-3 py-1.5 font-medium">{c.key.replace(/\|/g, ' · ')}</td>
                  <td className="px-3 py-1.5">
                    <input type="number" value={c.price ?? ''} onChange={(e) => setCombo(c.key, { price: e.target.value ? Number(e.target.value) : undefined })} className="h-7 w-24 rounded border border-input bg-background px-2" />
                  </td>
                  <td className="px-3 py-1.5">
                    <input type="number" value={c.quantity ?? ''} onChange={(e) => setCombo(c.key, { quantity: e.target.value ? Number(e.target.value) : undefined })} className="h-7 w-20 rounded border border-input bg-background px-2" />
                  </td>
                  <td className="px-3 py-1.5">
                    <input value={c.sku ?? ''} onChange={(e) => setCombo(c.key, { sku: e.target.value })} className="h-7 w-32 rounded border border-input bg-background px-2" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
