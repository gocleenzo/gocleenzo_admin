'use client'

import { useEffect, useState, useCallback } from 'react'

type Row = {
  id: string; worker: string; phone: string; tier: string
  amount: number; orders_at: number; status: string
  earned_at: string | null; paid_at: string | null
}
type Cfg = { tier: string; rank: number; min_orders: number; bonus_amount: number; label: string }

const inr = (n: number) => '₹' + (n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })

const TIER_COLOR: Record<string, string> = {
  bronze: '#B45309', silver: '#64748B', gold: '#D97706',
  platinum: '#7C3AED', diamond: '#0891B2',
}
const STATUS: Record<string, { bg: string; fg: string; label: string }> = {
  earned:   { bg: '#dcfce7', fg: '#15803d', label: 'Earned' },
  paid:     { bg: '#dbeafe', fg: '#1d4ed8', label: 'Paid' },
  rejected: { bg: '#fee2e2', fg: '#b91c1c', label: 'Rejected' },
}

export default function AdminTiersPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [config, setConfig] = useState<Cfg[]>([])
  const [filter, setFilter] = useState<'earned' | 'paid' | 'rejected' | 'all'>('earned')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [totals, setTotals] = useState({ earned: 0, paid: 0 })
  const [edits, setEdits] = useState<Record<string, { min: string; bonus: string }>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/tiers?status=${filter}`, { cache: 'no-store' })
      const j = await res.json()
      setRows(j.rows ?? [])
      setConfig(j.config ?? [])
      setTotals({ earned: j.totalEarned ?? 0, paid: j.totalPaid ?? 0 })
      const e: Record<string, { min: string; bonus: string }> = {}
      for (const c of (j.config ?? [])) e[c.tier] = { min: String(c.min_orders), bonus: String(c.bonus_amount) }
      setEdits(e)
    } catch { setRows([]) } finally { setLoading(false) }
  }, [filter])

  useEffect(() => { load() }, [load])

  async function act(id: string, action: 'pay' | 'reject') {
    if (action === 'reject' && !window.confirm('Reject this tier bonus?')) return
    setBusy(id)
    try {
      await fetch('/api/tiers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      })
      await load()
    } finally { setBusy(null) }
  }

  async function saveCfg(tier: string) {
    const e = edits[tier]; if (!e) return
    setBusy('cfg-' + tier)
    try {
      await fetch('/api/tiers', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, min_orders: e.min, bonus_amount: e.bonus }),
      })
      await load()
    } finally { setBusy(null) }
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-black text-slate-900">Worker Tiers</h1>
        <p className="text-sm text-slate-500">Set thresholds &amp; bonuses, and pay tier rewards</p>
      </div>

      {/* config editor */}
      <div className="rounded-xl bg-white border border-slate-200 p-4 mb-6">
        <p className="text-sm font-black text-slate-800 mb-3">Tier configuration</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {config.map((c) => (
            <div key={c.tier} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-3 h-3 rounded-full" style={{ background: TIER_COLOR[c.tier] ?? '#999' }} />
                <span className="font-black text-slate-800 capitalize">{c.tier}</span>
              </div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase">Orders</label>
              <input type="number" value={edits[c.tier]?.min ?? ''}
                onChange={(e) => setEdits(p => ({ ...p, [c.tier]: { ...p[c.tier], min: e.target.value } }))}
                className="w-full mb-2 px-2 py-1.5 rounded-lg border border-slate-200 text-sm" />
              <label className="block text-[11px] font-bold text-slate-400 uppercase">Bonus ₹</label>
              <input type="number" value={edits[c.tier]?.bonus ?? ''}
                onChange={(e) => setEdits(p => ({ ...p, [c.tier]: { ...p[c.tier], bonus: e.target.value } }))}
                className="w-full mb-2 px-2 py-1.5 rounded-lg border border-slate-200 text-sm" />
              <button disabled={busy === 'cfg-' + c.tier} onClick={() => saveCfg(c.tier)}
                className="w-full py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50"
                style={{ background: TIER_COLOR[c.tier] ?? '#0891B2' }}>
                {busy === 'cfg-' + c.tier ? 'Saving…' : 'Save'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* totals */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <p className="text-[11px] font-bold text-slate-400 uppercase">Bonuses to pay</p>
          <p className="text-xl font-black text-green-600 mt-1">{inr(totals.earned)}</p>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <p className="text-[11px] font-bold text-slate-400 uppercase">Total paid</p>
          <p className="text-xl font-black text-blue-600 mt-1">{inr(totals.paid)}</p>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <p className="text-[11px] font-bold text-slate-400 uppercase">Records</p>
          <p className="text-xl font-black text-slate-800 mt-1">{rows.length}</p>
        </div>
      </div>

      {/* filter */}
      <div className="inline-flex p-1 rounded-xl bg-slate-100 mb-4 flex-wrap">
        {(['earned', 'paid', 'rejected', 'all'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-colors ${
              filter === f ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-500'}`}>{f}</button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-slate-600 font-bold">No {filter === 'all' ? '' : filter} tier bonuses</p>
          <p className="text-xs text-slate-400 mt-1">Bonuses appear as workers reach tiers.</p>
        </div>
      ) : (
        <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5 font-bold">Worker</th>
                  <th className="px-3 py-2.5 font-bold">Tier</th>
                  <th className="px-3 py-2.5 font-bold text-center">At orders</th>
                  <th className="px-3 py-2.5 font-bold text-right">Bonus</th>
                  <th className="px-3 py-2.5 font-bold">Status</th>
                  <th className="px-4 py-2.5 font-bold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const s = STATUS[r.status] ?? STATUS.earned
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5">
                        <span className="font-bold text-slate-800">{r.worker}</span>
                        <span className="block text-[11px] text-slate-400">{r.phone}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5 font-bold capitalize"
                          style={{ color: TIER_COLOR[r.tier] ?? '#334155' }}>
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: TIER_COLOR[r.tier] ?? '#999' }} />
                          {r.tier}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center text-slate-600">{r.orders_at}</td>
                      <td className="px-3 py-2.5 text-right font-black text-slate-900">{inr(r.amount)}</td>
                      <td className="px-3 py-2.5">
                        <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold"
                          style={{ background: s.bg, color: s.fg }}>{s.label}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {r.status === 'earned' ? (
                          <div className="flex gap-1.5 justify-end">
                            <button disabled={busy === r.id} onClick={() => act(r.id, 'pay')}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50" style={{ background: '#16a34a' }}>
                              Mark paid
                            </button>
                            <button disabled={busy === r.id} onClick={() => act(r.id, 'reject')}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50" style={{ background: '#dc2626' }}>
                              Reject
                            </button>
                          </div>
                        ) : <span className="text-[11px] text-slate-400">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}