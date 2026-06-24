'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { TeamSettings } from './team-settings'
import { McpSettings } from './mcp-settings'
import { LIVE_CONFIRM_WORD } from '@/lib/mesh/mesh-constants'
import type { Workshop } from './war-room'

interface Cfg {
  mode: 'auto' | 'observe_only'
  focus: string
  blacklist: string[]
  tradeMode: 'paper' | 'live'
  watchlist: string[]
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
  { key: 'data', label: '数据源' },
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
// 归一 server 返回的 config,缺字段给默认,防 .join/.map 崩(老 server 或异常返回时)。
const normCfg = (c: Partial<Cfg> | undefined): Cfg => ({
  mode: c?.mode ?? 'auto',
  focus: c?.focus ?? '',
  blacklist: c?.blacklist ?? [],
  tradeMode: c?.tradeMode ?? 'paper',
  watchlist: c?.watchlist ?? [],
})

export function WorkshopSettings({ workshop, onBack }: { workshop: Workshop; onBack: () => void }) {
  const [tab, setTab] = useState('basic')
  const [name, setName] = useState(workshop.name)
  const [description, setDescription] = useState(workshop.description)
  const [cfg, setCfg] = useState<Cfg>({ mode: 'auto', focus: '', blacklist: [], tradeMode: 'paper', watchlist: [] })
  const [risk, setRisk] = useState<Risk>(DEFAULT_RISK)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loadedTradeMode, setLoadedTradeMode] = useState<'paper' | 'live'>('paper') // 已持久化的真盘态,判是否在切换
  const [liveConfirm, setLiveConfirm] = useState('') // paper→live 的确认词
  const [err, setErr] = useState('')

  useEffect(() => {
    fetch(`/api/mesh/config?accountId=${workshop.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.config) {
          const c = normCfg(d.config)
          setCfg(c)
          setLoadedTradeMode(c.tradeMode)
        }
        if (d?.risk) setRisk(d.risk)
      })
      .catch(() => {})
  }, [workshop.id])

  const save = async () => {
    setSaving(true)
    setSaved(false)
    setErr('')
    try {
      // 基本信息（名称/描述）落 workshop；模式/关注/黑名单/风控/真盘落 config
      await fetch('/api/mesh/workshops', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: workshop.id, name, description }),
      })
      const r = await fetch('/api/mesh/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...cfg, risk, accountId: workshop.id, ...(cfg.tradeMode === 'live' ? { liveConfirm } : {}) }),
      })
      const d = await r.json()
      if (!r.ok) {
        setErr(d?.error || '保存失败')
        return
      }
      if (d?.config) {
        const c = normCfg(d.config)
        setCfg(c)
        setLoadedTradeMode(c.tradeMode)
      }
      if (d?.risk) setRisk(d.risk)
      setLiveConfirm('')
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  const riskNum = (key: keyof Risk, label: string) => (
    <Field label={label}>
      <input type="number" className={INPUT} value={risk[key] as number} onChange={(e) => setRisk((s) => ({ ...s, [key]: num(e.target.value) }))} />
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
              <Field label="名称">
                <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="描述">
                <input className={INPUT} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="这个工作室做什么策略" />
              </Field>
              <Field label="关注重点（focus）">
                <input className={INPUT} value={cfg.focus} onChange={(e) => setCfg((c) => ({ ...c, focus: e.target.value }))} placeholder="如：盯封装主线、半导体回踩" />
              </Field>
            </Section>
          )}

          {tab === 'team' && <TeamSettings accountId={workshop.id} />}

          {tab === 'risk' && (
            <Section title="风控规则">
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
                <Field label="交易模式">
                  <select className={INPUT} value={cfg.mode} onChange={(e) => setCfg((c) => ({ ...c, mode: e.target.value as Cfg['mode'] }))}>
                    <option value="auto">自动交易</option>
                    <option value="observe_only">只看不买</option>
                  </select>
                </Field>
                <Field label="自选股（团队盯/交易的票；买新股必须先加进来，否则因无行情被拒）">
                  <input
                    className={INPUT}
                    value={cfg.watchlist.join('、')}
                    onChange={(e) => setCfg((c) => ({ ...c, watchlist: e.target.value.split(/[，,、\s]+/).filter(Boolean) }))}
                    placeholder="逗号或顿号分隔，如 600160.SH、300750.SZ（留空=只管现有持仓）"
                  />
                </Field>
                <Field label={`初始资金 ${TODO}`}>
                  <input className={INPUT} defaultValue="100000" disabled />
                </Field>
                <p className="text-xs text-neutral-400">盯盘节奏在「团队信息」里每个 agent 自己的工作循环</p>
              </Section>

              <Section title="实盘接入">
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                  真盘 = 真实下单、真金白银。需 Windows + 国金 QMT 客户端登录 + qmt 交易后端就绪;开启前请先用模拟盘 / DRY_RUN 验过链路。
                </div>
                <label className="flex items-center gap-2 text-sm text-neutral-700">
                  <input
                    type="checkbox"
                    checked={cfg.tradeMode === 'live'}
                    onChange={(e) => {
                      setCfg((c) => ({ ...c, tradeMode: e.target.checked ? 'live' : 'paper' }))
                      setLiveConfirm('')
                    }}
                    className="h-4 w-4"
                  />
                  接入真盘（真实下单）
                </label>
                {cfg.tradeMode === 'live' && loadedTradeMode !== 'live' && (
                  <Field label={`确认开启真盘：请输入「${LIVE_CONFIRM_WORD}」`}>
                    <input className={INPUT} value={liveConfirm} onChange={(e) => setLiveConfirm(e.target.value)} placeholder={LIVE_CONFIRM_WORD} />
                  </Field>
                )}
                {cfg.tradeMode === 'live' && loadedTradeMode === 'live' && (
                  <p className="text-xs text-amber-600">⚠ 真盘已开启,下单会走真实券商。关掉此勾选并保存即回模拟盘。</p>
                )}
                <p className="text-xs text-neutral-400">关掉=回模拟盘(paper),随时可。后端默认用随包的 qmt 交易脚本;DRY_RUN(空跑)仍由后端控制。</p>
              </Section>
            </div>
          )}

          {tab === 'data' && <McpSettings />}
        </div>
      </div>

      {tab !== 'data' && (
        <div className="mt-8 flex items-center gap-3 border-t border-neutral-200 pt-4">
          <button onClick={save} disabled={saving} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
            {saving ? '保存中…' : '保存'}
          </button>
          <button onClick={onBack} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
            取消
          </button>
          {saved && <span className="text-sm text-emerald-600">已保存（名称/描述/模式/关注/黑名单/风控/真盘）</span>}
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      )}
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
