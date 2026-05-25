'use client';

import * as React from 'react';

import { useEtsyErank } from '../use-demo-state';
import { ExecutorToggle } from './ExecutorToggle';
import { useEtsyErankHealth } from './HealthBanner';

import { PROMPT_REGISTRY } from '@/lib/etsy-erank/prompts';

const KIND_META: Record<'llm' | 'rules' | 'note', { label: string; cls: string }> = {
  llm: { label: 'LLM 提示词', cls: 'bg-sky-500/10 text-sky-700 ring-sky-500/30' },
  rules: { label: 'Code 规则', cls: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/30' },
  note: { label: '说明', cls: 'bg-muted text-muted-foreground ring-border' },
};

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
  const { settingsOpen, dispatch } = useEtsyErank();
  const { health, loading: healthLoading, probe: reprobe } = useEtsyErankHealth();
  const [openPrompt, setOpenPrompt] = React.useState<string | null>(null);

  if (!settingsOpen) return null;
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
          <Block title="环境检查(实时)">
            <div className="space-y-2">
              <div className="rounded-xl bg-background p-3 ring-1 ring-border text-xs">
                <div className="mb-1 font-medium">AdsPower 指纹浏览器</div>
                {healthLoading && !health ? (
                  <div className="text-muted-foreground">探测中…</div>
                ) : health?.adspower.available ? (
                  <div className="text-emerald-700">
                    ✓ 已连 · profile <span className="font-mono">{health.adspower.profileId}</span> · debug port <span className="font-mono">{health.adspower.debugPort}</span>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">API: {health.adspower.apiBase}</div>
                  </div>
                ) : (
                  <div className="text-amber-700">
                    ✗ 不可用 · profile <span className="font-mono">{health?.adspower.profileId}</span>
                    {health?.adspower.error && <div className="mt-0.5 text-[10px] opacity-90 break-all">{health.adspower.error}</div>}
                    <div className="mt-1 text-[10px] text-muted-foreground">解决:启动 AdsPower 桌面端;通过 env <span className="font-mono">ADSPOWER_PROFILE_ID</span> 改 profile</div>
                  </div>
                )}
              </div>

              <div className="rounded-xl bg-background p-3 ring-1 ring-border text-xs">
                <div className="mb-1 font-medium">LLM 服务商(用于 ⑤ 解读 + ⑥ 切入建议)</div>
                {healthLoading && !health ? (
                  <div className="text-muted-foreground">探测中…</div>
                ) : health?.llm.available ? (
                  <div className="text-emerald-700">
                    ✓ 已连 · <span className="font-semibold">{health.llm.providerName}</span> · model {health.llm.model}
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{health.llm.baseUrl}</div>
                  </div>
                ) : (
                  <div className="text-amber-700">
                    ✗ 不可用
                    {health?.llm.providerName && <span> · 当前选的: <span className="font-semibold">{health.llm.providerName}</span></span>}
                    {health?.llm.error && <div className="mt-0.5 text-[10px] opacity-90 break-all">{health.llm.error}</div>}
                    <div className="mt-1 text-[10px] text-muted-foreground">解决:在 Lumos 设置 → 服务商 切换到一个支持 text-gen 且 api_key 模式的 anthropic-compatible provider</div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={reprobe}
                className="rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-border hover:bg-muted"
              >
                重新探测
              </button>
            </div>
          </Block>

          <Block title="执行器默认(只影响 ②④)">
            <ExecutorToggle />
          </Block>

          <Block title="AI 提示词 / Code 规则(只读 · UI 显示和实际跑的是同一份)">
            <div className="space-y-1.5">
              {PROMPT_REGISTRY.map((p) => {
                const km = KIND_META[p.kind];
                return (
                  <div key={p.id} className="rounded-lg ring-1 ring-border">
                    <button
                      type="button"
                      onClick={() => setOpenPrompt(openPrompt === p.id ? null : p.id)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm font-medium"
                    >
                      <span className="flex items-center gap-2">
                        {p.title}
                        <span className={`rounded px-1.5 py-0.5 text-[10px] ring-1 ${km.cls}`}>{km.label}</span>
                        <span className="text-xs font-normal text-muted-foreground">{p.subtitle}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {openPrompt === p.id ? '收起' : '展开'}
                      </span>
                    </button>
                    {openPrompt === p.id && (
                      <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap border-t bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                        {p.body}
                      </pre>
                    )}
                  </div>
                );
              })}
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
