'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { TeamSettings } from './team-settings'

interface Workshop {
  id: string
  name: string
  desc: string
  status: string
}

interface Cfg {
  mode: 'auto' | 'observe_only'
  focus: string
  blacklist: string[]
}
interface Risk {
  maxOrderNotional: number
  maxSymbolQty: number
  maxTotalNotional: number
  noChaseLimitUp: boolean
  maxDailyLossAbs: number
  maxOrderCount: number
  maxDailyNotional: number
}

const SETTING_TABS = [
  { key: 'basic', label: '基本信息' },
  { key: 'team', label: '团队信息' },
  { key: 'risk', label: '风控规则' },
  { key: 'run', label: '运行 & 实盘' },
]

const INPUT = 'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400'
const TODO = '（暂未接后端存储）'
const DEFAULT_RISK: Risk = {
  maxOrderNotional: 50000,
  maxSymbolQty: 10000,
  maxTotalNotional: 200000,
  noChaseLimitUp: true,
  maxDailyLossAbs: 20000,
  maxOrderCount: 20,
  maxDailyNotional: 300000,
}
const num = (v: string) => Number(v) || 0

export function WorkshopSettings({ workshop, onBack }: { workshop: Workshop; onBack: () => void }) {
  const [tab, setTab] = useState('basic')
  const [cfg, setCfg] = useState<Cfg>({ mode: 'auto', focus: '', blacklist: [] })
  const [risk, setRisk] = useState<Risk>(DEFAULT_RISK)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/mesh/config')
      .then((r) => r.json())
      .then((d) => {
        if (d?.config) setCfg(d.config)
        if (d?.risk) setRisk(d.risk)
      })
      .catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const r = await fetch('/api/mesh/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...cfg, risk }),
      })
      const d = await r.json()
      if (d?.config) setCfg(d.config)
      if (d?.risk) setRisk(d.risk)
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  const riskNum = (key: keyof Risk, label: string) => (
    <Field label={label}>
      <input
        type="number"
        className={INPUT}
        value={risk[key] as number}
        onChange={(e) => setRisk((s) => ({ ...s, [key]: num(e.target.value) }))}
      />
    </Field>
  )

  return (
    <div>
      <button onClick={onBack} className="mb-4 text-sm text-neutral-500 hover:text-neutral-900">
        ← 返回
      </button>
      <h1 className="mb-1 text-lg font-semibold text-neutral-900">工作室设置</h1>
      <p className="mb-6 text-sm text-neutral-500">{workshop.name} · 仅停止状态下可修改</p>

      <div className="flex gap-6">
        <nav className="w-36 shrink-0 space-y-1">
          {SETTING_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                tab === t.key ? 'bg-neutral-100 font-medium text-neutral-900' : 'text-neutral-500 hover:bg-neutral-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {tab === 'basic' && (
            <Section title="基本信息">
              <Field label={`名称 ${TODO}`}>
                <input className={INPUT} defaultValue={workshop.name} />
              </Field>
              <Field label="关注重点（focus · 已接存储）">
                <input className={INPUT} value={cfg.focus} onChange={(e) => setCfg((c) => ({ ...c, focus: e.target.value }))} placeholder="如：盯封装主线、半导体回踩" />
              </Field>
            </Section>
          )}

          {tab === 'team' && <TeamSettings />}

          {tab === 'risk' && (
            <Section title="风控规则（已接存储）">
              <Field label="黑名单（永不交易）">
                <input
                  className={INPUT}
                  value={cfg.blacklist.join('、')}
                  onChange={(e) => setCfg((c) => ({ ...c, blacklist: e.target.value.split(/[，,、\s]+/).filter(Boolean) }))}
                  placeholder="逗号或顿号分隔，如 600160.SH、300750.SZ"
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                {riskNum('maxOrderNotional', '单笔最大金额')}
                {riskNum('maxSymbolQty', '单票最大持仓（股）')}
                {riskNum('maxTotalNotional', '总持仓市值上限')}
                {riskNum('maxDailyLossAbs', '单日最大亏损（总闸）')}
                {riskNum('maxOrderCount', '单日最大下单笔数（总闸）')}
                {riskNum('maxDailyNotional', '单日最大下单金额（总闸）')}
              </div>
              <label className="flex items-center gap-2 text-sm text-neutral-700">
                <input type="checkbox" checked={risk.noChaseLimitUp} onChange={(e) => setRisk((s) => ({ ...s, noChaseLimitUp: e.target.checked }))} className="h-4 w-4" />
                涨停不追
              </label>
            </Section>
          )}

          {tab === 'run' && (
            <div className="space-y-6">
              <Section title="运行设置">
                <Field label="交易模式（已接存储）">
                  <select className={INPUT} value={cfg.mode} onChange={(e) => setCfg((c) => ({ ...c, mode: e.target.value as Cfg['mode'] }))}>
                    <option value="auto">自动交易</option>
                    <option value="observe_only">只看不买</option>
                  </select>
                </Field>
                <Field label={`初始资金 ${TODO}`}>
                  <input className={INPUT} defaultValue="100000" disabled />
                </Field>
                <p className="text-xs text-neutral-400">盯盘节奏在「团队信息」里每个 agent 自己的工作循环</p>
              </Section>

              <Section title="实盘接入">
                <label className="flex items-start gap-2 text-sm text-neutral-700">
                  <input type="checkbox" disabled className="mt-0.5 h-4 w-4" />
                  <span>接入实盘 {TODO}（env 控制，需 Windows + qmt）</span>
                </label>
              </Section>
            </div>
          )}
        </div>
      </div>

      <div className="mt-8 flex items-center gap-3 border-t border-neutral-200 pt-4">
        <button onClick={save} disabled={saving} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
          {saving ? '保存中…' : '保存'}
        </button>
        <button onClick={onBack} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
          取消
        </button>
        {saved && <span className="text-sm text-emerald-600">已保存（模式/关注/黑名单/风控规则）</span>}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5">
      <h2 className="mb-4 text-sm font-medium text-neutral-900">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm text-neutral-600">{label}</label>
      {children}
    </div>
  )
}
