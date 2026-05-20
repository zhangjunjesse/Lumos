'use client';

import * as React from 'react';

import { QUOTA_MONTHLY_CAP } from '../etsy-erank-types';
import { QUOTA_PERIOD } from '../mock-data';
import { useEtsyErank } from '../use-demo-state';
import { ExecutorToggle } from './ExecutorToggle';

const PROMPTS = [
  { id: '1', title: '① 圈猎场', body: '把「我能做/能采购的能力」映射成 3–5 个 Etsy 类目方向,每个一句话。只列方向,不编搜索数据。' },
  { id: '3', title: '③ 收敛', body: '聚成微类目/产品假设;去重;删大词根;每簇补 3–5 长尾。总数 ≤120,输出 CSV,不给搜索量。' },
  { id: '5', title: '⑤ 打分', body: '硬门槛任一即淘汰:月搜<100 / CTR=Unknown / 竞争>10万 / KD=100。A=月搜≥150∧竞争<5000∧KD<30∧CTR≥80%;B=竞争<5万∧KD<50∧月搜≥100∧CTR≥80%;C=需求强但竞争/KD高。只用表里数字,不许编。' },
];

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function SettingsSheet(): React.ReactElement | null {
  const { settingsOpen, profileConfigured, quotaUsed, remaining, ledger, dispatch } =
    useEtsyErank();
  const [profile, setProfile] = React.useState('');
  const [openPrompt, setOpenPrompt] = React.useState<string | null>(null);

  if (!settingsOpen) return null;
  const pct = Math.round((quotaUsed / QUOTA_MONTHLY_CAP) * 100);
  const close = () => dispatch({ t: 'toggle-settings', v: false });

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-card shadow-xl ring-1 ring-border">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold">配额与设置</h2>
          <button
            type="button"
            onClick={close}
            className="rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
          >
            关闭
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          <Block title={`配额台账 · ${QUOTA_PERIOD}`}>
            <div className="rounded-xl bg-background p-3 ring-1 ring-border">
              <p className="tabular-nums text-sm">
                已用 <span className="font-semibold">{quotaUsed}</span> / {QUOTA_MONTHLY_CAP} · 余{' '}
                <span className={remaining < 40 ? 'text-red-600' : 'text-emerald-600'}>
                  {remaining}
                </span>
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full ${pct > 80 ? 'bg-red-500' : 'bg-foreground'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            <div className="overflow-hidden rounded-xl bg-background ring-1 ring-border text-sm">
              {ledger.map((e, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 border-b px-3 py-2 tabular-nums last:border-0"
                >
                  <span className="truncate">{e.step}</span>
                  <span className="shrink-0 text-red-600">-{e.debited}</span>
                  <span className="shrink-0 text-muted-foreground">余{e.balanceAfter}</span>
                </div>
              ))}
            </div>
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              <li>· ② 采种子零配额 · ③ 硬卡 ≤120 · ④ 按词扣账</li>
              <li>· ④ 预估 &gt; 余额 → 拒跑,不静默烧</li>
            </ul>
          </Block>

          <Block title="AdsPower(eRank 登录态在指纹浏览器,不写死仓库)">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={profile}
                onChange={(e) => setProfile(e.target.value)}
                className="rounded-lg border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">未选择 profile</option>
                <option value="k1ck97si">k1ck97si「内地」(登着 eRank)</option>
                <option value="k1cjt46k">k1cjt46k(非 eRank)</option>
              </select>
              <button
                type="button"
                onClick={() => dispatch({ t: 'profile', v: profile === 'k1ck97si' })}
                className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background"
              >
                测试连接
              </button>
            </div>
            <p
              className={`text-xs ${profileConfigured ? 'text-emerald-600' : 'text-muted-foreground'}`}
            >
              {profileConfigured
                ? '✓ 已连 eRank 登录态,AdsPower 自动执行器可用'
                : '未配置 → AdsPower 自动执行器不可用,只能用粘贴'}
            </p>
          </Block>

          <Block title="执行器默认(只影响 ②④)">
            <ExecutorToggle />
          </Block>

          <Block title="AI 提示词(只读 · 固化 SOP §3.4/§3.2)">
            <div className="space-y-1.5">
              {PROMPTS.map((p) => (
                <div key={p.id} className="rounded-lg ring-1 ring-border">
                  <button
                    type="button"
                    onClick={() => setOpenPrompt(openPrompt === p.id ? null : p.id)}
                    className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium"
                  >
                    {p.title}
                    <span className="text-xs text-muted-foreground">
                      {openPrompt === p.id ? '收起' : '展开'}
                    </span>
                  </button>
                  {openPrompt === p.id && (
                    <p className="border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      {p.body}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Block>

          <Block title="风险边界(只读)">
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>· 不做:供应链确认 / 定价定稿 / listing 文案 / 上新排期</li>
              <li>· AdsPower 自动对反自动化/字段漂移脆弱 → 始终保留粘贴兜底</li>
              <li>· 自动失败必转人工可接管,不静默重试烧配额</li>
            </ul>
          </Block>
        </div>
      </div>
    </div>
  );
}
