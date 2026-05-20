'use client';

import * as React from 'react';

import { useEtsyErank } from '../use-demo-state';

/** ②④ 执行器切换。只影响 ②④,③⑤⑥ 不变;可中途切。 */
export function ExecutorToggle(): React.ReactElement {
  const { executor, dispatch } = useEtsyErank();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">执行器(只影响②④):</span>
      <div className="inline-flex overflow-hidden rounded-lg ring-1 ring-border">
        {(
          [
            ['paste', '粘贴 / CSV 导入'],
            ['adspower', 'AdsPower 自动'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => dispatch({ t: 'executor', v: key })}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              executor === key
                ? 'bg-foreground text-background'
                : 'bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
