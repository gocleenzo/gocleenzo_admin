'use client'

import { useEffect, useState, useCallback } from 'react'

type Worker = {
  worker_id: string
  name: string
  phone: string
  verified: boolean
  base: number
  order: number
  travel: number
  total: number
  shiftHours: number
  orderHours: number
  travelDays: number
}
type Grand = { base: number; order: number; travel: number; total: number }
type Claim = {
  id: string
  worker_id: string
  name: string
  phone: string
  date: string
  mode: string | null
  photo: string
  amount: number
  status: string
  note: string | null
  reject_reason: string | null
  created_at: string
}
type Payout = {
  id: string
  worker_id: string
  name: string
  phone: string
  from: string
  to: string
  base: number
  order: number
  travel: number
  amount: number
  original_amount: number | null
  amount_adjusted_by_admin: boolean
  adjustment_reason: string | null
  status: string
  method: string | null
  reference: string | null
  reject_reason: string | null
  note: string | null
  requested_at: string
  paid_at: string | null
}
type Referral = {
  id: string
  referrer: string
  referrer_phone: string
  referred: string
  code: string
  status: string
  jobs: number
  amount: number
  earned_at: string | null
  paid_at: string | null
  created_at: string
}

const inr = (n: number) =>
  '₹' + (n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function fmtDate(d: string) {
  const x = new Date(d)
  return isNaN(x.getTime()) ? d : x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function weekRange() {
  const now = new Date()
  const day = (now.getDay() + 6) % 7
  const from = new Date(now); from.setDate(now.getDate() - day)
  return { from: iso(from), to: iso(now) }
}
function monthRange() {
  const now = new Date()
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) }
}

export default function PayrollPage() {
  const [tab, setTab] = useState<'earnings' | 'claims' | 'referrals' | 'payouts'>('earnings')
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    let on = true
    async function n() {
      try {
        const res = await fetch('/api/payroll/payouts?status=requested', { cache: 'no-store' })
        const j = await res.json()
        if (on) setPendingCount((j.requests ?? []).length)
      } catch { /* ignore */ }
    }
    n(); const t = setInterval(n, 30000); return () => { on = false; clearInterval(t) }
  }, [])

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-black text-slate-900">Payroll</h1>
        <p className="text-sm text-slate-500">Earnings, travel, referrals, and worker payouts — all money in one place</p>
      </div>

      <div className="inline-flex p-1 rounded-xl bg-slate-100 mb-5 flex-wrap">
        {([
          ['earnings', 'Earnings'],
          ['claims', 'Travel claims'],
          ['referrals', 'Refer & Earn'],
          ['payouts', 'Payout requests'],
        ] as const).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
              tab === t ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-500'
            }`}
          >
            {label}
            {t === 'payouts' && pendingCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black text-white bg-rose-500">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'earnings' && <EarningsTab />}
      {tab === 'claims' && <ClaimsTab />}
      {tab === 'referrals' && <ReferralsTab />}
      {tab === 'payouts' && <PayoutsTab />}
    </div>
  )
}

// ─────────────────────────── EARNINGS ───────────────────────────
function EarningsTab() {
  const [preset, setPreset] = useState<'week' | 'month' | 'custom'>('week')
  const [range, setRange] = useState(weekRange())
  const [workers, setWorkers] = useState<Worker[]>([])
  const [grand, setGrand] = useState<Grand | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Worker | null>(null)
  // Bonus (referral + tier, earned+paid, lifetime) keyed by worker_id —
  // computed ONCE for every worker in the current list, right after
  // `workers` loads. Reused both for the new "Bonus" table column AND
  // the detail drawer, so a worker with no referral/tier reward shows
  // nothing in either place, and there's only one round of fetches
  // instead of a separate one every time a row is clicked.
  const [bonusByWorker, setBonusByWorker] = useState<Record<string, number>>({})
  const [bonusLoading, setBonusLoading] = useState(false)

  const [refPaid, setRefPaid] = useState(0)
  const [refPend, setRefPend] = useState(0)
  const [tierPaid, setTierPaid] = useState(0)
  const [tierPend, setTierPend] = useState(0)
  const [travelPaid, setTravelPaid] = useState(0)
  const [travelPend, setTravelPend] = useState(0)
  const [poPaidBO, setPoPaidBO] = useState(0)
  const [poPendBO, setPoPendBO] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/payroll/earnings?from=${range.from}&to=${range.to}`, { cache: 'no-store' })
      const json = await res.json()
      setWorkers(json.workers ?? [])
      setGrand(json.grand ?? null)
    } catch {
      setWorkers([]); setGrand(null)
    } finally {
      setLoading(false)
    }
  }, [range])

  const loadExtras = useCallback(async () => {
    try {
      const [refRes, tierRes, claimRes, poRes] = await Promise.all([
        fetch('/api/referrals?status=all', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
        fetch('/api/tiers?status=all', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
        fetch('/api/payroll/claims?status=all', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
        fetch('/api/payroll/payouts?status=all', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
      ])
      const refs = refRes?.referrals ?? refRes?.rows ?? []
      let rp = 0, rq = 0
      for (const r of refs) { if (r.status === 'paid') rp += Number(r.amount ?? 0); else if (r.status === 'earned') rq += Number(r.amount ?? 0) }
      setRefPaid(rp); setRefPend(rq)

      const tiers = tierRes?.rewards ?? tierRes?.rows ?? []
      let tp = 0, tq = 0
      for (const t of tiers) { if (t.status === 'paid') tp += Number(t.amount ?? 0); else if (t.status === 'earned') tq += Number(t.amount ?? 0) }
      setTierPaid(tp); setTierPend(tq)

      const claims = claimRes?.claims ?? []
      let cp = 0, cq = 0
      for (const c of claims) { if (c.status === 'approved') cp += Number(c.amount ?? 0); else if (c.status === 'pending') cq += Number(c.amount ?? 0) }
      setTravelPaid(cp); setTravelPend(cq)

      const payouts = poRes?.requests ?? []
      let pp = 0, pq = 0
      for (const p of payouts) {
        const bo = Number(p.base ?? 0) + Number(p.order ?? 0)
        if (p.status === 'paid') pp += bo
        else if (p.status !== 'rejected') pq += bo
      }
      setPoPaidBO(pp); setPoPendBO(pq)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadExtras() }, [loadExtras])

  // Fetch referral+tier bonus for EVERY worker in the current list, once,
  // right after `workers` loads — not per row click. Each worker's
  // referral/tier rows are fetched in parallel via the existing
  // worker_id-filtered endpoints; a worker with zero earned+paid
  // referral/tier amount simply doesn't appear in the resulting map
  // (checked with `?? 0` everywhere it's read), so they show nothing
  // in the new Bonus column or the drawer — only workers who've
  // actually earned one get a value.
  useEffect(() => {
    if (workers.length === 0) { setBonusByWorker({}); return }
    let cancelled = false
    setBonusLoading(true)
    ;(async () => {
      try {
        const entries = await Promise.all(workers.map(async (w) => {
          try {
            const [refRes, tierRes] = await Promise.all([
              fetch(`/api/referrals?status=all&worker_id=${w.worker_id}`, { cache: 'no-store' })
                .then(r => r.json()).catch(() => null),
              fetch(`/api/tiers?status=all&worker_id=${w.worker_id}`, { cache: 'no-store' })
                .then(r => r.json()).catch(() => null),
            ])
            const refs = refRes?.referrals ?? refRes?.rows ?? []
            const refTotal = refs
              .filter((r: any) => r.status === 'earned' || r.status === 'paid')
              .reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0)

            const tiers = tierRes?.rewards ?? tierRes?.rows ?? []
            const tierTotal = tiers
              .filter((t: any) => t.status === 'earned' || t.status === 'paid')
              .reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0)

            return [w.worker_id, refTotal + tierTotal] as const
          } catch {
            return [w.worker_id, 0] as const
          }
        }))
        if (cancelled) return
        const map: Record<string, number> = {}
        for (const [id, amt] of entries) {
          if (amt > 0) map[id] = amt
        }
        setBonusByWorker(map)
      } finally {
        if (!cancelled) setBonusLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [workers])

  function choosePreset(p: 'week' | 'month' | 'custom') {
    setPreset(p)
    if (p === 'week') setRange(weekRange())
    else if (p === 'month') setRange(monthRange())
  }

  const paidTotal = poPaidBO + travelPaid + refPaid + tierPaid
  const pendTotal = poPendBO + travelPend + refPend + tierPend

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-xl p-4" style={{ background: 'linear-gradient(135deg,#ECFDF5,#D1FAE5)' }}>
          <p className="text-[10px] font-black uppercase tracking-wider text-green-600">Total paid out</p>
          <p className="text-2xl font-black text-green-700 mt-1">{inr(paidTotal)}</p>
        </div>
        <div className="rounded-xl p-4" style={{ background: 'linear-gradient(135deg,#FFFBEB,#FEF3C7)' }}>
          <p className="text-[10px] font-black uppercase tracking-wider text-amber-600">Pending / owed</p>
          <p className="text-2xl font-black text-amber-700 mt-1">{inr(pendTotal)}</p>
        </div>
      </div>
      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden mb-5">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
          <p className="text-xs font-black text-slate-700">Money breakdown by source</p>
        </div>
        {[
          ['Base + Order pay', poPaidBO, poPendBO, '#0891B2'],
          ['Travel allowance', travelPaid, travelPend, '#D97706'],
          ['Refer & Earn', refPaid, refPend, '#7C3AED'],
          ['Tier bonus', tierPaid, tierPend, '#059669'],
        ].map(([label, paid, pend, color]) => (
          <div key={label as string} className="flex items-center justify-between px-4 py-3 border-b border-slate-100 last:border-0">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: color as string }} />
              <span className="text-[13px] font-bold text-slate-700">{label as string}</span>
            </div>
            <div className="flex items-center gap-5">
              <div className="text-right">
                <p className="text-[9px] text-slate-400 uppercase">Paid</p>
                <p className="text-[13px] font-black text-green-600">{inr(paid as number)}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] text-slate-400 uppercase">Pending</p>
                <p className="text-[13px] font-black text-amber-600">{inr(pend as number)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="inline-flex p-1 rounded-xl bg-slate-100">
          {(['week', 'month', 'custom'] as const).map((p) => (
            <button key={p} onClick={() => choosePreset(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                preset === p ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-500'
              }`}>
              {p[0].toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
            <span className="text-slate-400 text-xs">to</span>
            <input type="date" value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
          </div>
        )}
        <span className="text-xs text-slate-400 ml-auto">{range.from} → {range.to}</span>
      </div>

      {grand && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {[
            { l: 'Base pay', v: grand.base, c: '#2563eb' },
            { l: 'Order incentive', v: grand.order, c: '#0891b2' },
            { l: 'Travel', v: grand.travel, c: '#d97706' },
            { l: 'Total wage bill', v: grand.total, c: '#0f172a' },
          ].map((g) => (
            <div key={g.l} className="rounded-xl bg-white border border-slate-200 p-3">
              <p className="text-[11px] text-slate-500 font-semibold">{g.l}</p>
              <p className="text-lg font-black mt-0.5" style={{ color: g.c }}>{inr(g.v)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5 font-bold">Worker</th>
                <th className="px-3 py-2.5 font-bold text-right">Base</th>
                <th className="px-3 py-2.5 font-bold text-right">Order</th>
                <th className="px-3 py-2.5 font-bold text-right">Travel</th>
                <th className="px-3 py-2.5 font-bold text-right">Bonus</th>
                <th className="px-4 py-2.5 font-bold text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
              ) : workers.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No workers found.</td></tr>
              ) : (
                workers.map((w) => {
                  const bonus = bonusByWorker[w.worker_id] ?? 0
                  return (
                    <tr key={w.worker_id} onClick={() => setSelected(w)}
                      className="hover:bg-cyan-50/50 cursor-pointer transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800">{w.name}</span>
                          {w.verified && <span title="Verified" className="text-cyan-600">✓</span>}
                        </div>
                        <span className="text-[11px] text-slate-400">
                          {w.shiftHours.toFixed(1)}h shift · {w.orderHours.toFixed(1)}h orders
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-600">{inr(w.base)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-600">{inr(w.order)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-600">{inr(w.travel)}</td>
                      <td className="px-3 py-2.5 text-right">
                        {bonusLoading ? (
                          <span className="text-slate-300">…</span>
                        ) : bonus > 0 ? (
                          <span className="font-bold text-violet-600">{inr(bonus)}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-black text-slate-900">{inr(w.total + bonus)}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-[9998] flex justify-end" onClick={() => setSelected(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-md bg-white h-full overflow-y-auto p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-black text-slate-900">{selected.name}</h2>
                <p className="text-sm text-slate-500">{selected.phone || 'No phone'}</p>
              </div>
              <button onClick={() => setSelected(null)}
                className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 font-bold">✕</button>
            </div>
            <div className="rounded-2xl p-5 mb-4 text-white" style={{ background: 'linear-gradient(135deg,#0e7490,#06b6d4)' }}>
              <p className="text-sm opacity-90">Total earnings</p>
              <p className="text-3xl font-black mt-1">
                {inr(selected.total + (bonusByWorker[selected.worker_id] ?? 0))}
              </p>
              <p className="text-xs opacity-80 mt-1">{range.from} → {range.to}</p>
            </div>
            <div className="space-y-2">
              <BreakRow label="Base pay" sub={`₹50/hr × ${selected.shiftHours.toFixed(2)}h shift`} amt={selected.base} color="#2563eb" />
              <BreakRow label="Order incentive" sub={`₹32/hr × ${selected.orderHours.toFixed(2)}h booked service (incl. extra time)`} amt={selected.order} color="#0891b2" />
              <BreakRow label="Travel allowance" sub={`Automatic — ${selected.travelDays} scheduled day(s) completed`} amt={selected.travel} color="#d97706" />
              {bonusLoading ? (
                <div className="rounded-xl border border-slate-200 p-3 text-center text-xs text-slate-400">
                  Loading bonus…
                </div>
              ) : (bonusByWorker[selected.worker_id] ?? 0) > 0 && (
                <BreakRow label="Bonus" sub="Refer & Earn + Tier bonus (earned + paid)" amt={bonusByWorker[selected.worker_id]} color="#7c3aed" />
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-4">Travel allowance is now automatic — no claim submission needed. The Bonus amount shown here covers this worker&apos;s full lifetime earned+paid referral and tier total, not just this date range.</p>
          </div>
        </div>
      )}
    </div>
  )
}

function BreakRow({ label, sub, amt, color }: { label: string; sub: string; amt: number; color: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
      <div>
        <p className="font-bold text-slate-800 text-sm">{label}</p>
        <p className="text-[11px] text-slate-400">{sub}</p>
      </div>
      <p className="font-black" style={{ color }}>{inr(amt)}</p>
    </div>
  )
}

// ─────────────────────────── CLAIMS ───────────────────────────
function ClaimsTab() {
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending')
  const [claims, setClaims] = useState<Claim[]>([])
  const [loading, setLoading] = useState(true)
  const [zoom, setZoom] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/payroll/claims?status=${filter}`, { cache: 'no-store' })
      const json = await res.json()
      setClaims(json.claims ?? [])
    } catch { setClaims([]) } finally { setLoading(false) }
  }, [filter])

  useEffect(() => { load() }, [load])

  async function act(id: string, action: 'approve' | 'reject') {
    let reason: string | null = null
    if (action === 'reject') reason = window.prompt('Reason for rejection:') || null
    setBusy(id)
    try {
      await fetch('/api/payroll/claims', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, reason }),
      })
      await load()
    } finally { setBusy(null) }
  }

  const modeIcon = (m: string | null) => m === 'bus' ? '🚌' : m === 'rickshaw' ? '🛺' : '🧾'

  return (
    <div>
      <div className="inline-flex p-1 rounded-xl bg-slate-100 mb-4">
        {(['pending', 'approved', 'rejected', 'all'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-colors ${
              filter === f ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-500'
            }`}>{f}</button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-400">Loading…</div>
      ) : claims.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-slate-600 font-bold">No {filter === 'all' ? '' : filter} claims</p>
          <p className="text-xs text-slate-400 mt-1">Worker travel proofs appear here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {claims.map((c) => (
            <div key={c.id} className="rounded-xl bg-white border border-slate-200 overflow-hidden">
              <div className="flex">
                <button onClick={() => setZoom(c.photo)} className="w-28 h-28 bg-slate-100 shrink-0 relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.photo} alt="proof" className="w-full h-full object-cover" />
                  <span className="absolute bottom-1 right-1 text-[9px] bg-black/60 text-white px-1.5 py-0.5 rounded">Tap</span>
                </button>
                <div className="flex-1 p-3 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span>{modeIcon(c.mode)}</span>
                    <p className="font-bold text-slate-800 text-sm truncate">{c.name}</p>
                  </div>
                  <p className="text-[11px] text-slate-400">{c.phone}</p>
                  <p className="text-[11px] text-slate-500 mt-1">{fmtDate(c.date)} · {c.mode ?? 'other'} · {inr(c.amount)}</p>
                  {c.status === 'pending' ? (
                    <div className="flex gap-2 mt-2">
                      <button disabled={busy === c.id} onClick={() => act(c.id, 'approve')}
                        className="flex-1 px-2 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50" style={{ background: '#16a34a' }}>Approve</button>
                      <button disabled={busy === c.id} onClick={() => act(c.id, 'reject')}
                        className="flex-1 px-2 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50" style={{ background: '#dc2626' }}>Reject</button>
                    </div>
                  ) : (
                    <div className="mt-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${
                        c.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>{c.status}</span>
                      {c.reject_reason && <p className="text-[11px] text-slate-400 mt-1 italic">{c.reject_reason}</p>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {zoom && (
        <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4" onClick={() => setZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="proof" className="max-w-full max-h-full rounded-xl" />
        </div>
      )}
    </div>
  )
}

// ─────────────────────────── REFERRALS ───────────────────────────
const REF_STATUS: Record<string, { bg: string; fg: string; label: string }> = {
  joined:   { bg: '#f1f5f9', fg: '#64748b', label: 'Joined' },
  earned:   { bg: '#fef3c7', fg: '#b45309', label: 'Earned' },
  paid:     { bg: '#dcfce7', fg: '#15803d', label: 'Paid' },
  rejected: { bg: '#fee2e2', fg: '#b91c1c', label: 'Rejected' },
}

function ReferralsTab() {
  const [filter, setFilter] = useState<'joined' | 'earned' | 'paid' | 'rejected' | 'all'>('earned')
  const [rows, setRows] = useState<Referral[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/referrals?status=${filter}`, { cache: 'no-store' })
      const json = await res.json()
      setRows(json.referrals ?? json.rows ?? [])
    } catch { setRows([]) } finally { setLoading(false) }
  }, [filter])

  useEffect(() => { load() }, [load])

  async function act(id: string, action: 'pay' | 'reject') {
    let reason: string | null = null
    if (action === 'reject') reason = window.prompt('Reason for rejection:') || null
    setBusy(id)
    try {
      await fetch('/api/referrals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, reason }),
      })
      await load()
    } finally { setBusy(null) }
  }

  const totalEarned = rows.filter(r => r.status === 'earned').reduce((s, r) => s + Number(r.amount ?? 0), 0)
  const totalPaid   = rows.filter(r => r.status === 'paid').reduce((s, r) => s + Number(r.amount ?? 0), 0)

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-xl p-4" style={{ background: 'linear-gradient(135deg,#ECFDF5,#D1FAE5)' }}>
          <p className="text-[10px] font-black uppercase tracking-wider text-green-600">Referral rewards paid</p>
          <p className="text-2xl font-black text-green-700 mt-1">{inr(totalPaid)}</p>
        </div>
        <div className="rounded-xl p-4" style={{ background: 'linear-gradient(135deg,#FFFBEB,#FEF3C7)' }}>
          <p className="text-[10px] font-black uppercase tracking-wider text-amber-600">Earned, awaiting payout</p>
          <p className="text-2xl font-black text-amber-700 mt-1">{inr(totalEarned)}</p>
        </div>
      </div>

      <div className="inline-flex p-1 rounded-xl bg-slate-100 mb-4 flex-wrap">
        {(['earned', 'paid', 'joined', 'rejected', 'all'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-colors ${
              filter === f ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-500'
            }`}>{f}</button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-slate-600 font-bold">No {filter === 'all' ? '' : filter} referrals</p>
          <p className="text-xs text-slate-400 mt-1">Worker referral rewards appear here.</p>
        </div>
      ) : (
        <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5 font-bold">Referrer</th>
                  <th className="px-3 py-2.5 font-bold">Referred</th>
                  <th className="px-3 py-2.5 font-bold">Code</th>
                  <th className="px-3 py-2.5 font-bold text-center">Jobs</th>
                  <th className="px-3 py-2.5 font-bold text-right">Reward</th>
                  <th className="px-3 py-2.5 font-bold">Status</th>
                  <th className="px-4 py-2.5 font-bold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const s = REF_STATUS[r.status] ?? REF_STATUS.joined
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5">
                        <span className="font-bold text-slate-800">{r.referrer}</span>
                        <span className="block text-[11px] text-slate-400">{r.referrer_phone}</span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">{r.referred}</td>
                      <td className="px-3 py-2.5"><span className="font-mono text-[12px] font-bold text-violet-700">{r.code}</span></td>
                      <td className="px-3 py-2.5 text-center text-slate-600">{r.jobs}</td>
                      <td className="px-3 py-2.5 text-right font-black text-slate-900">{inr(r.amount)}</td>
                      <td className="px-3 py-2.5">
                        <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold"
                          style={{ background: s.bg, color: s.fg }}>{s.label}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {r.status === 'earned' ? (
                          <div className="flex gap-1.5 justify-end">
                            <ActBtn label="Pay" color="#15803d" busy={busy === r.id} onClick={() => act(r.id, 'pay')} />
                            <ActBtn label="Reject" color="#dc2626" busy={busy === r.id} onClick={() => act(r.id, 'reject')} />
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">—</span>
                        )}
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

// ─────────────────────────── PAYOUTS ───────────────────────────
const PO_STATUS: Record<string, { bg: string; fg: string; label: string }> = {
  requested:  { bg: '#fef3c7', fg: '#b45309', label: 'Requested' },
  approved:   { bg: '#dbeafe', fg: '#1d4ed8', label: 'Approved' },
  processing: { bg: '#e0e7ff', fg: '#4338ca', label: 'Processing' },
  paid:       { bg: '#dcfce7', fg: '#15803d', label: 'Paid' },
  rejected:   { bg: '#fee2e2', fg: '#b91c1c', label: 'Rejected' },
}
const PO_STATUS_ORDER: Array<keyof typeof PO_STATUS> = ['requested', 'approved', 'processing', 'paid', 'rejected']

function PayoutsTab() {
  const [filter, setFilter] = useState<'requested' | 'approved' | 'processing' | 'paid' | 'rejected' | 'all'>('requested')
  const [rows, setRows] = useState<Payout[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [detail, setDetail] = useState<Payout | null>(null)

  // Editable-amount inline state
  const [amountDraft, setAmountDraft] = useState('')
  const [amountReason, setAmountReason] = useState('')
  const [editingAmount, setEditingAmount] = useState(false)
  const [amountError, setAmountError] = useState<string | null>(null)

  // Free status-change controls
  const [statusDraft, setStatusDraft] = useState<string>('')
  const [statusReason, setStatusReason] = useState('')
  const [statusError, setStatusError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/payroll/payouts?status=${filter}`, { cache: 'no-store' })
      const json = await res.json()
      setRows(json.requests ?? [])
    } catch { setRows([]) } finally { setLoading(false) }
  }, [filter])

  useEffect(() => { load() }, [load])

  function openDetail(r: Payout) {
    setDetail(r)
    setEditingAmount(false)
    setAmountDraft(String(r.amount))
    setAmountReason('')
    setAmountError(null)
    setStatusDraft(r.status)
    setStatusReason('')
    setStatusError(null)
  }

  async function saveAmount(id: string) {
    const amountNum = Number(amountDraft)
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      setAmountError('Enter a valid non-negative amount.')
      return
    }
    if (!amountReason.trim()) {
      setAmountError('A reason is required when changing the amount.')
      return
    }
    setBusy(id)
    setAmountError(null)
    try {
      const res = await fetch('/api/payroll/payouts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'update_amount', amount: amountNum, reason: amountReason.trim() }),
      })
      const json = await res.json()
      if (!res.ok) { setAmountError(json?.error ?? 'Could not save the amount.'); return }
      await load()
      setEditingAmount(false)
      setAmountReason('')
      setDetail(prev => prev ? {
        ...prev,
        amount: amountNum,
        amount_adjusted_by_admin: true,
        adjustment_reason: amountReason.trim(),
        original_amount: prev.original_amount ?? prev.amount,
      } : prev)
    } finally { setBusy(null) }
  }

  async function saveStatus(id: string, currentStatus: string) {
    if (!statusDraft || statusDraft === currentStatus) return
    if (statusDraft === 'rejected' && !statusReason.trim()) {
      setStatusError('A reason is required to reject a payout.')
      return
    }
    let method: string | null = null
    let reference: string | null = null
    if (statusDraft === 'paid') {
      method = window.prompt('Payment method (upi / bank / cash):', 'upi') || null
      reference = window.prompt('Reference / txn id:') || null
    }
    setBusy(id)
    setStatusError(null)
    try {
      const res = await fetch('/api/payroll/payouts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'set_status', status: statusDraft, reason: statusReason.trim() || null, method, reference }),
      })
      const json = await res.json()
      if (!res.ok) { setStatusError(json?.error ?? 'Could not change status.'); return }
      await load()
      setDetail(null)
    } finally { setBusy(null) }
  }

  async function quickAct(id: string, action: 'approve' | 'reject' | 'processing' | 'paid') {
    let body: any = { id, action: 'set_status' }
    const statusMap = { approve: 'approved', reject: 'rejected', processing: 'processing', paid: 'paid' } as const
    body.status = statusMap[action]
    if (action === 'reject') {
      body.reason = window.prompt('Reason for rejection:') || null
      if (!body.reason) return
    }
    if (action === 'paid') {
      body.method = window.prompt('Payment method (upi / bank / cash):', 'upi') || null
      body.reference = window.prompt('Reference / txn id:') || null
    }
    setBusy(id)
    try {
      const res = await fetch('/api/payroll/payouts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        alert(json?.error ?? 'Could not update this payout.')
        return
      }
      await load()
      setDetail(null)
    } finally { setBusy(null) }
  }

  return (
    <div>
      <div className="inline-flex p-1 rounded-xl bg-slate-100 mb-4 flex-wrap">
        {(['requested', 'approved', 'processing', 'paid', 'rejected', 'all'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-colors ${
              filter === f ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-500'
            }`}>{f}</button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-slate-600 font-bold">No {filter === 'all' ? '' : filter} payout requests</p>
          <p className="text-xs text-slate-400 mt-1">Worker withdrawal requests appear here.</p>
        </div>
      ) : (
        <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5 font-bold">Worker</th>
                  <th className="px-3 py-2.5 font-bold">Period</th>
                  <th className="px-3 py-2.5 font-bold text-right">Amount</th>
                  <th className="px-3 py-2.5 font-bold">Status</th>
                  <th className="px-4 py-2.5 font-bold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const s = PO_STATUS[r.status] ?? PO_STATUS.requested
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5">
                        <button onClick={() => openDetail(r)} className="text-left">
                          <span className="font-bold text-slate-800 hover:text-cyan-700">{r.name}</span>
                          <span className="block text-[11px] text-slate-400">{r.phone}</span>
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                        {fmtDate(r.from)} – {fmtDate(r.to)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="font-black text-slate-900">{inr(r.amount)}</span>
                        {r.amount_adjusted_by_admin && (
                          <span className="block text-[10px] font-bold text-violet-600">Adjusted</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold"
                          style={{ background: s.bg, color: s.fg }}>{s.label}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex gap-1.5 justify-end">
                          {r.status === 'requested' && (
                            <>
                              <ActBtn label="Approve" color="#2563eb" busy={busy === r.id} onClick={() => quickAct(r.id, 'approve')} />
                              <ActBtn label="Reject" color="#dc2626" busy={busy === r.id} onClick={() => quickAct(r.id, 'reject')} />
                            </>
                          )}
                          {r.status === 'approved' && (
                            <ActBtn label="Mark processing" color="#4338ca" busy={busy === r.id} onClick={() => quickAct(r.id, 'processing')} />
                          )}
                          {r.status === 'processing' && (
                            <ActBtn label="Mark paid" color="#15803d" busy={busy === r.id} onClick={() => quickAct(r.id, 'paid')} />
                          )}
                          <button onClick={() => openDetail(r)} className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-600">
                            {r.status === 'paid' || r.status === 'rejected' ? 'View' : 'Edit'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-[9998] flex justify-end" onClick={() => setDetail(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-md bg-white h-full overflow-y-auto p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-black text-slate-900">{detail.name}</h2>
                <p className="text-sm text-slate-500">{detail.phone || 'No phone'}</p>
              </div>
              <button onClick={() => setDetail(null)} className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 font-bold">✕</button>
            </div>

            <div className="rounded-2xl p-5 mb-2 text-white" style={{ background: 'linear-gradient(135deg,#0e7490,#06b6d4)' }}>
              <div className="flex items-center justify-between">
                <p className="text-sm opacity-90">Payout amount</p>
                {!editingAmount && (
                  <button
                    onClick={() => { setEditingAmount(true); setAmountDraft(String(detail.amount)); setAmountReason(''); setAmountError(null) }}
                    className="text-xs font-bold underline underline-offset-2 opacity-90 hover:opacity-100"
                  >
                    Edit
                  </button>
                )}
              </div>

              {editingAmount ? (
                <div className="mt-2 space-y-2">
                  <input
                    type="number" min={0} step="0.01"
                    value={amountDraft}
                    onChange={(e) => setAmountDraft(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-slate-900 text-lg font-black outline-none"
                  />
                  <input
                    type="text"
                    placeholder="Reason for changing the amount (required)"
                    value={amountReason}
                    onChange={(e) => setAmountReason(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-slate-900 text-xs outline-none"
                  />
                  {amountError && <p className="text-xs bg-red-500/20 rounded px-2 py-1">{amountError}</p>}
                  <div className="flex gap-2">
                    <button
                      disabled={busy === detail.id}
                      onClick={() => saveAmount(detail.id)}
                      className="flex-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-cyan-700 disabled:opacity-50"
                    >
                      {busy === detail.id ? 'Saving…' : 'Save amount'}
                    </button>
                    <button
                      onClick={() => { setEditingAmount(false); setAmountError(null) }}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/20"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-3xl font-black mt-1">{inr(detail.amount)}</p>
                  <p className="text-xs opacity-80 mt-1">{fmtDate(detail.from)} – {fmtDate(detail.to)}</p>
                </>
              )}
            </div>

            {detail.amount_adjusted_by_admin && !editingAmount && (
              <div className="rounded-xl bg-violet-50 border border-violet-200 px-3 py-2 mb-4">
                <p className="text-[11px] font-bold text-violet-700">
                  ✎ Adjusted by admin{detail.original_amount != null ? ` — originally ${inr(detail.original_amount)}` : ''}
                </p>
                {detail.adjustment_reason && (
                  <p className="text-[11px] text-violet-600 mt-0.5 italic">{detail.adjustment_reason}</p>
                )}
              </div>
            )}

            <p className="text-[11px] font-black uppercase tracking-wide text-slate-400 mb-2">Breakdown (cross-check)</p>
            <div className="space-y-2 mb-4">
              <BreakRow label="Base pay" sub="₹50/hr × scheduled hours" amt={detail.base} color="#2563eb" />
                            <BreakRow label="Order incentive" sub="₹32/hr × booked service duration + extra time (not scheduled hours)" amt={detail.order} color="#0891b2" />
              <BreakRow label="Travel allowance" sub="automatic — no claim submission" amt={detail.travel} color="#d97706" />
            </div>

            {detail.note && <p className="text-sm text-slate-600 mb-3">Note: <span className="italic">{detail.note}</span></p>}
            {detail.method && <p className="text-sm text-slate-600">Paid via <b>{detail.method}</b>{detail.reference ? ` · ${detail.reference}` : ''}</p>}
            {detail.reject_reason && <p className="text-sm text-red-600">Rejected: {detail.reject_reason}</p>}

            <div className="mt-5 pt-4 border-t border-slate-100">
              <p className="text-[11px] font-black uppercase tracking-wide text-slate-400 mb-2">Change status</p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {PO_STATUS_ORDER.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setStatusDraft(s); setStatusError(null) }}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-all"
                    style={{
                      background: statusDraft === s ? PO_STATUS[s].bg : '#fff',
                      color: statusDraft === s ? PO_STATUS[s].fg : '#64748b',
                      borderColor: statusDraft === s ? PO_STATUS[s].fg + '40' : '#E2E8F0',
                    }}
                  >
                    {PO_STATUS[s].label}
                  </button>
                ))}
              </div>
              {statusDraft === 'rejected' && (
                <input
                  type="text"
                  placeholder="Reason for rejection (required)"
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs outline-none mb-2"
                />
              )}
              {statusDraft !== 'rejected' && statusDraft !== detail.status && (
                <input
                  type="text"
                  placeholder="Note about this change (optional)"
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs outline-none mb-2"
                />
              )}
              {statusError && <p className="text-xs text-red-600 mb-2">{statusError}</p>}
              <button
                disabled={busy === detail.id || statusDraft === detail.status}
                onClick={() => saveStatus(detail.id, detail.status)}
                className="w-full px-3 py-2.5 rounded-lg text-sm font-bold text-white disabled:opacity-40"
                style={{ background: '#0891B2' }}
              >
                {busy === detail.id ? '…' : statusDraft === detail.status ? 'No change' : `Move to ${PO_STATUS[statusDraft as keyof typeof PO_STATUS]?.label ?? statusDraft}`}
              </button>
              <p className="text-[10px] text-slate-400 mt-2">
                Status can be moved to any step directly — e.g. to correct a mistaken action —
                not only the usual next step in the sequence.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ActBtn({ label, color, busy, onClick, wide }: { label: string; color: string; busy: boolean; onClick: () => void; wide?: boolean }) {
  return (
    <button disabled={busy} onClick={onClick}
      className={`px-2.5 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50 ${wide ? 'flex-1 py-2.5 text-sm' : ''}`}
      style={{ background: color }}>
      {busy ? '…' : label}
    </button>
  )
}