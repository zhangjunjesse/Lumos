// 变体组合构建：按属性做笛卡尔积，重建 combos 时保留已有组合的价/库存/SKU。
import type { VariationCombo, VariationProperty, Variations } from '@/lib/etsy-forge/listing/types';

export function comboKeys(props: VariationProperty[]): string[] {
  const active = props.filter((p) => p.options.length > 0);
  if (active.length === 0) return [];
  let keys: string[] = [''];
  for (const p of active) {
    const next: string[] = [];
    for (const k of keys) for (const o of p.options) next.push(k ? `${k}|${o}` : o);
    keys = next;
  }
  return keys;
}

export function rebuildCombos(v: Variations): VariationCombo[] {
  const keys = comboKeys(v.properties);
  const byKey = new Map(v.combos.map((c) => [c.key, c]));
  return keys.map((key) => byKey.get(key) ?? { key });
}
