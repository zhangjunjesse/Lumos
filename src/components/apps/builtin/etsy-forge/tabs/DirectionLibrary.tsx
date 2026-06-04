'use client';

// 裂变·方向库选择器:按轴(A-H)分组、全部可见的 chip 多选。AI 推荐的高亮(★),用户随便挑/换/加/减。
// 红线:完整库始终可见;这里只做选择,诊断只是建议。

import type { RemixDirection } from '../api-client';

export function DirectionLibrary({
  directions,
  selected,
  recommend,
  onToggle,
}: {
  directions: RemixDirection[];
  selected: Set<string>;
  recommend: Set<string>;
  onToggle: (code: string) => void;
}) {
  // 按轴分组,保留 sort 顺序
  const byAxis = new Map<string, { name: string; items: RemixDirection[] }>();
  for (const d of directions) {
    if (!d.enabled) continue;
    const g = byAxis.get(d.axis) ?? { name: d.axis_name, items: [] };
    g.items.push(d);
    byAxis.set(d.axis, g);
  }
  const axes = [...byAxis.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-2">
      {axes.map(([axis, g]) => (
        <div key={axis}>
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">
            {axis} · {g.name}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {g.items.map((d) => {
              const on = selected.has(d.code);
              const rec = recommend.has(d.code);
              return (
                <button
                  key={d.code}
                  type="button"
                  onClick={() => onToggle(d.code)}
                  title={d.hint}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                    on ? 'bg-foreground text-background' : rec ? 'border-sky-500 text-sky-600 hover:bg-muted' : 'hover:bg-muted'
                  }`}
                >
                  {rec && !on && <span className="mr-0.5">★</span>}
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
