'use client';

import * as React from 'react';

import { CONVERGE_COUNT } from '../mock-data';
import { useEtsyErank } from '../use-demo-state';

/** ④ Bulk 验真:配额闸 + 粘贴回灌 / AdsPower 后台 / 未配置 三态 */
export function VerifyStep(): React.ReactElement {
  const { executor, profileConfigured, steps, remaining, pasteText, dispatch } = useEtsyErank();
  const done = steps.verify === 'done';
  const enough = remaining >= CONVERGE_COUNT;

  if (done) {
    return (
      <div className="rounded-lg bg-emerald-500/5 px-3 py-2 text-emerald-700 ring-1 ring-emerald-500/20">
        已回灌 {CONVERGE_COUNT} 词真实数据 · 扣配额 {CONVERGE_COUNT} · 余 {remaining}。
        下一步 ⑤ AI 打分。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        className={`rounded-lg px-3 py-2 text-xs ring-1 ${
          enough
            ? 'bg-amber-500/5 text-amber-700 ring-amber-500/20'
            : 'bg-red-500/5 text-red-700 ring-red-500/20'
        }`}
      >
        配额闸:预估扣 {CONVERGE_COUNT} 词 · 余额 {remaining} ·{' '}
        {enough ? '≤ 余额,可跑' : '余额不足,本轮暂停,下次配额重置再跑'}
      </div>

      {executor === 'paste' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded bg-muted px-2 py-1">1 复制收敛清单 {CONVERGE_COUNT} 词</span>
            <span>→ 2 去 eRank Bulk Keyword Tool 跑 → 导出 CSV →</span>
            <span className="rounded bg-muted px-2 py-1">3 粘贴回灌</span>
          </div>
          <textarea
            value={pasteText}
            onChange={(e) => dispatch({ t: 'paste', v: e.target.value })}
            placeholder="keyword,searches,clicks,ctr,competition,kd,trend  ← 粘贴 eRank 导出(按列名映射,不按位置)"
            className="h-20 w-full rounded-lg border bg-background p-2 font-mono text-xs"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!enough}
              onClick={() => dispatch({ t: 'verify' })}
              className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
            >
              解析并回灌(扣配额)
            </button>
            <span className="text-xs text-muted-foreground">
              已识别 {pasteText ? CONVERGE_COUNT : 0}/{CONVERGE_COUNT} · 解析后才扣;字段漂移→失败可重试,不静默
            </span>
          </div>
        </div>
      )}

      {executor === 'adspower' && !profileConfigured && (
        <div className="rounded-lg bg-red-500/5 px-3 py-3 ring-1 ring-red-500/20">
          <p className="text-sm font-medium text-red-700">⨂ 未配置:没有已登录 eRank 的 AdsPower profile</p>
          <p className="mt-1 text-xs text-muted-foreground">自动执行器不可用。eRank 登录态在指纹浏览器,需先配。</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => dispatch({ t: 'toggle-settings', v: true })}
              className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background"
            >
              去设置配置 profile
            </button>
            <button
              type="button"
              onClick={() => dispatch({ t: 'executor', v: 'paste' })}
              className="rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-border hover:bg-muted"
            >
              本轮改用粘贴
            </button>
          </div>
        </div>
      )}

      {executor === 'adspower' && profileConfigured && (
        <div className="rounded-lg bg-sky-500/5 px-3 py-3 ring-1 ring-sky-500/20">
          <p className="text-sm font-medium text-sky-700">● 运行中 · AdsPower 后台</p>
          <p className="mt-1 text-xs text-muted-foreground">
            profile k1ck97si「内地」· 已连 CDP · 进度 64/{CONVERGE_COUNT} ·
            后台跑不抢当前界面;断连不关窗;不调 stop
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={!enough}
              onClick={() => dispatch({ t: 'verify' })}
              className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
            >
              模拟完成回灌
            </button>
            <button
              type="button"
              onClick={() => dispatch({ t: 'executor', v: 'paste' })}
              className="rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-border hover:bg-muted"
            >
              中止并转粘贴接管
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
