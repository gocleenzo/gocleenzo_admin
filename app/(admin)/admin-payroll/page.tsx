'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'

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
  const [tab, setTab] = useState<'wallet' | 'earnings' | 'tiers' | 'claims' | 'referrals' | 'payouts'>('wallet')
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
          ['wallet', '💸 Wallet & Payouts'],
          ['earnings', 'Earnings'],
          ['tiers', '🏆 Tiers & bonus'],
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

      {tab === 'wallet' && <WalletTab />}
      {tab === 'earnings' && <EarningsTab />}
      {tab === 'tiers' && <TiersTab />}
      {tab === 'claims' && <ClaimsTab />}
      {tab === 'referrals' && <ReferralsTab />}
      {tab === 'payouts' && <PayoutsTab />}
    </div>
  )
}

// ─────────────────────────── EARNINGS ───────────────────────────
function EarningsTab() {
  const supabase = createClient()
  const [preset, setPreset] = useState<'week' | 'month' | 'custom'>('month')
  const [range, setRange] = useState(monthRange())
  const [workers, setWorkers] = useState<Worker[]>([])
  const [grand, setGrand] = useState<Grand | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Worker | null>(null)
  // Bonus (referral + tier + manual, earned+paid, lifetime) keyed by
  // worker_id — computed ONCE for every worker in the current list,
  // right after `workers` loads. Reused both for the "Bonus" table
  // column AND the detail drawer, so a worker with no bonus of any
  // kind shows nothing in either place, and there's only one round of
  // fetches instead of a separate one every time a row is clicked.
  //
  // UPDATED: now also folds in one-time manual bonuses (the "Grant a
  // one-time bonus" feature on each worker's own Pay/Earnings/Bonus
  // tab) alongside the existing referral + tier total, via a direct
  // Supabase query — this page otherwise only calls /api/* routes, but
  // there's no dedicated route for manual bonuses yet, and this exact
  // worker_manual_bonuses query is already used the same way on the
  // Workers page and the Reports page, so this keeps the same pattern
  // rather than inventing a third way to read the same table.
  const [bonusByWorker, setBonusByWorker] = useState<Record<string, number>>({})
  const [bonusSplit, setBonusSplit] = useState<Record<string, { ref: number; tier: number; manual: number }>>({})
  // MONTHLY: every bonus is counted only inside the selected period, so on
  // the 1st of the month (period = "Month") all bonus figures start at ₹0.
  const inRange = (d: any) => {
    if (!d) return false
    const k = String(d).slice(0, 10)
    return k >= range.from && k <= range.to
  }
  // a tier reward belongs to the month it was earned for (period = 1st of month)
  const tierInRange = (t: any) => {
    const p = t.period ? String(t.period).slice(0, 7) : String(t.earned_at ?? '').slice(0, 7)
    return p >= range.from.slice(0, 7) && p <= range.to.slice(0, 7)
  }
  const [bonusLoading, setBonusLoading] = useState(false)

  const [refPaid, setRefPaid] = useState(0)
  const [refPend, setRefPend] = useState(0)
  const [tierPaid, setTierPaid] = useState(0)
  const [tierPend, setTierPend] = useState(0)
  // NEW: manual bonus paid/pending totals, for the "breakdown by
  // source" list — same earned/paid split as referral and tier above.
  const [manualBonusPaid, setManualBonusPaid] = useState(0)
  const [manualBonusPend, setManualBonusPend] = useState(0)
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
      const [refRes, tierRes, claimRes, poRes, bonusRes] = await Promise.all([
        fetch('/api/referrals?status=all', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
        Promise.resolve(supabase.from('tier_rewards').select('bonus_amount, status, period, earned_at')).catch(() => null),
        fetch('/api/payroll/claims?status=all', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
        fetch('/api/payroll/payouts?status=all', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
        // NEW: aggregate manual-bonus totals across every worker, for
        // the breakdown-by-source list — same earned('earned')+paid
        // status split every other source here already uses.
        Promise.resolve(supabase.from('worker_manual_bonuses').select('amount, status, created_at')).catch(() => null),
      ])
      const refs = refRes?.referrals ?? refRes?.rows ?? []
      let rp = 0, rq = 0
      for (const r of refs) {
        if (!inRange(r.earned_at ?? r.paid_at ?? r.created_at)) continue
        if (r.status === 'paid') rp += Number(r.amount ?? 0); else if (r.status === 'earned') rq += Number(r.amount ?? 0)
      }
      setRefPaid(rp); setRefPend(rq)

      const tiers = (tierRes as any)?.data ?? []
      let tp = 0, tq = 0
      for (const t of tiers) {
        if (!tierInRange(t)) continue
        if (t.status === 'paid') tp += Number(t.bonus_amount ?? 0); else if (t.status === 'earned') tq += Number(t.bonus_amount ?? 0)
      }
      setTierPaid(tp); setTierPend(tq)

      const claims = claimRes?.claims ?? []
      let cp = 0, cq = 0
      for (const c of claims) {
        if (!inRange(c.date ?? c.created_at)) continue
        if (c.status === 'approved') cp += Number(c.amount ?? 0); else if (c.status === 'pending') cq += Number(c.amount ?? 0)
      }
      setTravelPaid(cp); setTravelPend(cq)

      const payouts = poRes?.requests ?? []
      let pp = 0, pq = 0
      for (const p of payouts) {
        if (!inRange(p.to ?? p.requested_at)) continue
        const bo = Number(p.base ?? 0) + Number(p.order ?? 0)
        if (p.status === 'paid') pp += bo
        else if (p.status !== 'rejected') pq += bo
      }
      setPoPaidBO(pp); setPoPendBO(pq)

      const bonusRows = (bonusRes as any)?.data ?? []
      let mbp = 0, mbq = 0
      for (const b of bonusRows) {
        if (!inRange(b.created_at)) continue
        if (b.status === 'paid') mbp += Number(b.amount ?? 0)
        else if (b.status === 'earned') mbq += Number(b.amount ?? 0)
      }
      setManualBonusPaid(mbp); setManualBonusPend(mbq)
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadExtras() }, [loadExtras])

  // Fetch referral+tier+manual bonus for EVERY worker in the current
  // list, once, right after `workers` loads — not per row click. A
  // worker with zero earned+paid bonus of any kind simply doesn't
  // appear in the resulting map (checked with `?? 0` everywhere it's
  // read), so they show nothing in the Bonus column or the drawer —
  // only workers who've actually earned one get a value.
  useEffect(() => {
    if (workers.length === 0) { setBonusByWorker({}); return }
    let cancelled = false
    setBonusLoading(true)
    ;(async () => {
      try {
        const entries = await Promise.all(workers.map(async (w) => {
          try {
            const [refRes, tierRes, manualRes] = await Promise.all([
              fetch(`/api/referrals?status=all&worker_id=${w.worker_id}`, { cache: 'no-store' })
                .then(r => r.json()).catch(() => null),
              Promise.resolve(
                supabase.from('tier_rewards').select('bonus_amount, status, period, earned_at').eq('worker_id', w.worker_id)
              ).catch(() => null),
              // NEW: this worker's manual bonuses, same direct-Supabase
              // pattern as loadExtras() above, just scoped to one
              // worker_id instead of aggregated across everyone.
              Promise.resolve(
                supabase.from('worker_manual_bonuses').select('amount, status, created_at').eq('worker_id', w.worker_id)
              ).catch(() => null),
            ])
            const refs = refRes?.referrals ?? refRes?.rows ?? []
            const refTotal = refs
              .filter((r: any) => (r.status === 'earned' || r.status === 'paid') && inRange(r.earned_at ?? r.paid_at ?? r.created_at))
              .reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0)

            const tiers = (tierRes as any)?.data ?? []
            const tierTotal = tiers
              .filter((t: any) => (t.status === 'earned' || t.status === 'paid') && tierInRange(t))
              .reduce((s: number, t: any) => s + Number(t.bonus_amount ?? 0), 0)

            const manualRows = (manualRes as any)?.data ?? []
            const manualTotal = manualRows
              .filter((b: any) => (b.status === 'earned' || b.status === 'paid') && inRange(b.created_at))
              .reduce((s: number, b: any) => s + Number(b.amount ?? 0), 0)

            return [w.worker_id, refTotal + tierTotal + manualTotal, { ref: refTotal, tier: tierTotal, manual: manualTotal }] as const
          } catch {
            return [w.worker_id, 0, { ref: 0, tier: 0, manual: 0 }] as const
          }
        }))
        if (cancelled) return
        const map: Record<string, number> = {}
        const split: Record<string, { ref: number; tier: number; manual: number }> = {}
        for (const [id, amt, sp] of entries) {
          if (amt > 0) { map[id] = amt; split[id] = sp }
        }
        setBonusByWorker(map)
        setBonusSplit(split)
      } finally {
        if (!cancelled) setBonusLoading(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workers])

  function choosePreset(p: 'week' | 'month' | 'custom') {
    setPreset(p)
    if (p === 'week') setRange(weekRange())
    else if (p === 'month') setRange(monthRange())
  }

  const paidTotal = poPaidBO + travelPaid + refPaid + tierPaid + manualBonusPaid
  const pendTotal = poPendBO + travelPend + refPend + tierPend + manualBonusPend

  return (
    <div>
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
        <span className="text-xs text-slate-400 ml-auto">{range.from} → {range.to}{preset === 'month' && ' · bonuses restart at ₹0 on the 1st'}</span>
      </div>

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
          <p className="text-xs font-black text-slate-700">Money breakdown by source · selected period</p>
        </div>
        {[
          ['Base + Order pay', poPaidBO, poPendBO, '#0891B2'],
          ['Travel allowance', travelPaid, travelPend, '#D97706'],
          ['Refer & Earn', refPaid, refPend, '#7C3AED'],
          ['Tier bonus (in wallet)', tierPaid, tierPend, '#059669'],
          // NEW: manual one-time bonuses, same row shape as every
          // other source above.
          ['Manual bonus', manualBonusPaid, manualBonusPend, '#DB2777'],
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
                <>
                  {(bonusSplit[selected.worker_id]?.tier ?? 0) > 0 && <BreakRow label="Tier bonus" sub="Reached a tier this period · goes into wallet" amt={bonusSplit[selected.worker_id].tier} color="#059669" />}
                  {(bonusSplit[selected.worker_id]?.manual ?? 0) > 0 && <BreakRow label="Manual bonus" sub="Given by admin this period" amt={bonusSplit[selected.worker_id].manual} color="#db2777" />}
                  {(bonusSplit[selected.worker_id]?.ref ?? 0) > 0 && <BreakRow label="Refer & Earn" sub="Referral earned this period" amt={bonusSplit[selected.worker_id].ref} color="#7c3aed" />}
                </>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-4">Travel allowance is now automatic — no claim submission needed. Bonuses shown here are only the ones earned in this date range — on the 1st of every month they start again from ₹0.</p>
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

// ═════════════════════ WALLET & PAYOUTS TAB ═════════════════════
// Each professional's wallet — earned, paid, balance due, history.

/* ───────────────────────── types ───────────────────────── */
type W_ProRow = {
  worker_id: string; full_name: string; phone: string | null; is_verified: boolean
  balance: number; total_earned: number; total_paid: number
  month_earned: number; month_paid: number; last_payout: string | null; joined_on: string | null
}
type W_Order = { booking_id: string; time: string; service: string; minutes: number }
type W_Breakdown = {
  date?: string; amount?: number
  base_amount?: number; shift_hours?: number
  order_amount?: number; order_hours?: number
  overtime_amount?: number; overtime_hours?: number
  travel_amount?: number; penalty_amount?: number
  orders_count?: number; orders?: W_Order[]
  tier?: string; orders_at?: number; period_from?: string; period_to?: string
}
type W_Txn = {
  id: string; txn_date: string; kind: string; amount: number; title: string
  breakdown: W_Breakdown | null; method: string | null; reference: string | null
  note: string | null; created_at: string; editable: boolean
}
type W_Wallet = {
  balance: number; total_earned: number; total_paid: number; total_deducted: number
  month_earned: number; month_paid: number; last_payout: string | null
  joined_on: string | null; today: W_Breakdown; txns: W_Txn[]
}
type W_EntryKind = 'payout' | 'advance' | 'deduction' | 'credit' | 'opening_balance'

/* ───────────────────────── theme ───────────────────────── */
const W_CYAN = { 50: '#ECFEFF', 100: '#CFFAFE', 500: '#06B6D4', 600: '#0891B2', 700: '#0E7490' }
const W_GREEN = '#059669', W_GREEN_BG = '#ECFDF5'
const W_RED = '#DC2626', W_RED_BG = '#FEF2F2'
const W_INK = '#0F172A', W_BODY = '#475569', W_MUTED = '#64748B', W_FAINT = '#94A3B8'
const W_LINE = '#E2E8F0', W_CARD = '#FFFFFF', W_PAGE = '#F8FAFC'

/* ───────────────────────── helpers ───────────────────────── */
const W_n = (v: unknown) => Number(v ?? 0) || 0
const W_inr = (v: number, signed = false) => {
  const s = `₹${Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
  if (!signed) return v < 0 ? `−${s}` : s
  return v < 0 ? `− ${s}` : `+ ${s}`
}
const W_fmtDate = (d: string | null | undefined) =>
  d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const W_todayIST = () => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return p // YYYY-MM-DD
}

const W_KIND_ICON: Record<string, string> = {
  daily_earning: '📅', tier_bonus: '🏆', manual_bonus: '🎁', joining_bonus: '🎉', referral_bonus: '🤝',
  payout: '💸', advance: '⏩', deduction: '➖', credit: '➕', opening_balance: '📘', settlement: '✅',
}

/* ───────────────────────── page ───────────────────────── */
function WalletTab() {
  const [rows, setRows] = useState<W_ProRow[]>([])
  const [role, setRole] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'owed' | 'name' | 'last_paid' | 'earned'>('owed')
  const [openId, setOpenId] = useState<string | null>(null)
  const [quickPay, setQuickPay] = useState<W_ProRow | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/admin-auth/wallet', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not load payouts')
      setRows((json.professionals ?? []).map((r: any) => ({
        ...r,
        balance: W_n(r.balance), total_earned: W_n(r.total_earned), total_paid: W_n(r.total_paid),
        month_earned: W_n(r.month_earned), month_paid: W_n(r.month_paid),
      })))
      setRole(json.role ?? '')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const isOwner = role === 'owner'

  const list = useMemo(() => {
    const t = search.trim().toLowerCase()
    const f = rows.filter(r => !t || r.full_name.toLowerCase().includes(t) || (r.phone ?? '').includes(t))
    return f.sort((a, b) =>
      sort === 'owed' ? b.balance - a.balance
      : sort === 'earned' ? b.month_earned - a.month_earned
      : sort === 'last_paid' ? (b.last_payout ?? '').localeCompare(a.last_payout ?? '')
      : a.full_name.localeCompare(b.full_name))
  }, [rows, search, sort])

  const totals = useMemo(() => ({
    due: rows.reduce((s, r) => s + Math.max(0, r.balance), 0),
    monthEarned: rows.reduce((s, r) => s + r.month_earned, 0),
    monthPaid: rows.reduce((s, r) => s + r.month_paid, 0),
    owedCount: rows.filter(r => r.balance > 0).length,
  }), [rows])

  function exportCsv() {
    const head = ['Professional', 'Phone', 'Balance due', 'Earned (all time)', 'Paid (all time)', 'Earned this month', 'Paid this month', 'Last paid', 'Joined']
    const lines = list.map(r => [r.full_name, r.phone ?? '', r.balance, r.total_earned, r.total_paid, r.month_earned, r.month_paid, r.last_payout ?? '', r.joined_on ?? '']
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `cleenzo-payouts-${W_todayIST()}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const open = rows.find(r => r.worker_id === openId) ?? null

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <p className="text-sm" style={{ color: W_MUTED }}>
          Each professional&apos;s wallet — what they earned, what you paid, and what is still due.
          Record every payment here so it shows in their app.
        </p>
        <button onClick={exportCsv}
          className="px-4 py-2 rounded-xl text-sm font-bold"
          style={{ background: W_CARD, color: W_CYAN[700], border: `1px solid ${W_LINE}` }}>
          ⬇ Export (Excel)
        </button>
      </div>

      {/* totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total due to professionals', value: W_inr(totals.due), color: totals.due > 0 ? W_RED : W_INK },
          { label: 'Professionals owed', value: String(totals.owedCount), color: W_INK },
          { label: 'Earned this month', value: W_inr(totals.monthEarned), color: W_GREEN },
          { label: 'Paid this month', value: W_inr(totals.monthPaid), color: W_INK },
        ].map(t => (
          <div key={t.label} className="rounded-2xl p-4" style={{ background: W_CARD, border: `1px solid ${W_LINE}` }}>
            <p className="text-xs font-semibold" style={{ color: W_MUTED }}>{t.label}</p>
            <p className="text-2xl font-black mt-1" style={{ color: t.color }}>{t.value}</p>
          </div>
        ))}
      </div>

      {/* search + sort */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or phone…"
          className="flex-1 min-w-[200px] max-w-sm px-4 py-2.5 rounded-xl text-sm outline-none"
          style={{ background: W_CARD, border: `1px solid ${W_LINE}`, color: W_INK }} />
        <select value={sort} onChange={e => setSort(e.target.value as any)}
          className="px-3 py-2.5 rounded-xl text-sm font-semibold outline-none"
          style={{ background: W_CARD, border: `1px solid ${W_LINE}`, color: W_BODY }}>
          <option value="owed">Most owed first</option>
          <option value="earned">Most earned this month</option>
          <option value="last_paid">Recently paid</option>
          <option value="name">Name A–Z</option>
        </select>
        <button onClick={() => { setLoading(true); load() }}
          className="px-3 py-2.5 rounded-xl text-sm font-bold"
          style={{ background: W_CARD, border: `1px solid ${W_LINE}`, color: W_MUTED }}>↻ Refresh</button>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 mb-4 text-sm font-semibold" style={{ background: W_RED_BG, color: W_RED }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 flex justify-center">
          <div className="w-10 h-10 rounded-full border-4 animate-spin" style={{ borderColor: W_CYAN[100], borderTopColor: W_CYAN[600] }} />
        </div>
      ) : (
        <div className="rounded-2xl overflow-x-auto" style={{ background: W_CARD, border: `1px solid ${W_LINE}` }}>
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr style={{ background: W_PAGE, color: W_MUTED }} className="text-left text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-bold">Professional</th>
                <th className="px-4 py-3 font-bold text-right">Balance due</th>
                <th className="px-4 py-3 font-bold text-right">Earned (month)</th>
                <th className="px-4 py-3 font-bold text-right">Paid (month)</th>
                <th className="px-4 py-3 font-bold text-right">Paid (all time)</th>
                <th className="px-4 py-3 font-bold">Last paid</th>
                <th className="px-4 py-3 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map(r => (
                <tr key={r.worker_id} className="hover:bg-slate-50 cursor-pointer" style={{ borderTop: `1px solid ${W_LINE}` }}
                  onClick={() => setOpenId(r.worker_id)}>
                  <td className="px-4 py-3">
                    <p className="font-bold" style={{ color: W_INK }}>{r.full_name}{r.is_verified && <span title="KYC verified"> ✅</span>}</p>
                    <p className="text-xs" style={{ color: W_FAINT }}>{r.phone ?? ''}{r.joined_on && ` · joined ${W_fmtDate(r.joined_on)}`}</p>
                  </td>
                  <td className="px-4 py-3 text-right font-black" style={{ color: r.balance > 0 ? W_RED : r.balance < 0 ? W_GREEN : W_FAINT }}>
                    {W_inr(r.balance)}
                    {r.balance < 0 && <span className="block text-[10px] font-semibold">advance — adjusts from next earnings</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold" style={{ color: W_GREEN }}>{W_inr(r.month_earned)}</td>
                  <td className="px-4 py-3 text-right" style={{ color: W_BODY }}>{W_inr(r.month_paid)}</td>
                  <td className="px-4 py-3 text-right" style={{ color: W_BODY }}>{W_inr(r.total_paid)}</td>
                  <td className="px-4 py-3" style={{ color: W_BODY }}>{W_fmtDate(r.last_payout)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    {isOwner && r.balance > 0 && (
                      <button onClick={() => setQuickPay(r)}
                        className="px-3 py-1.5 rounded-lg text-xs font-black text-white mr-2"
                        style={{ background: W_CYAN[600] }}>💸 Pay</button>
                    )}
                    <button onClick={() => setOpenId(r.worker_id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold"
                      style={{ background: W_CYAN[50], color: W_CYAN[700] }}>History</button>
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center" style={{ color: W_FAINT }}>No professionals found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {quickPay && (
        <W_Modal onClose={() => setQuickPay(null)} title={`Record payout · ${quickPay.full_name}`}>
          <W_EntryForm workerId={quickPay.worker_id} kind="payout" suggested={quickPay.balance}
            onDone={() => { setQuickPay(null); load() }} onCancel={() => setQuickPay(null)} />
        </W_Modal>
      )}

      {open && (
        <W_WalletDrawer pro={open} isOwner={isOwner}
          onClose={() => setOpenId(null)} onChanged={load} />
      )}
    </div>
  )
}

/* ───────────────────────── drawer: one professional ───────────────────────── */
function W_WalletDrawer({ pro, isOwner, onClose, onChanged }: {
  pro: W_ProRow; isOwner: boolean; onClose: () => void; onChanged: () => void
}) {
  const [wallet, setWallet] = useState<W_Wallet | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [form, setForm] = useState<W_EntryKind | null>(null)
  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all')

  const load = useCallback(async () => {
    setErr(null)
    try {
      const res = await fetch(`/api/admin-auth/wallet?worker_id=${pro.worker_id}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not load wallet')
      const w = json.wallet
      setWallet({
        ...w,
        balance: W_n(w.balance), total_earned: W_n(w.total_earned), total_paid: W_n(w.total_paid),
        total_deducted: W_n(w.total_deducted), month_earned: W_n(w.month_earned), month_paid: W_n(w.month_paid),
        txns: (w.txns ?? []).map((t: any) => ({ ...t, amount: W_n(t.amount) })),
      })
    } catch (e: any) { setErr(e.message) }
  }, [pro.worker_id])

  useEffect(() => { load() }, [load])

  async function remove(t: W_Txn) {
    if (!window.confirm(`Remove "${t.title}" (${W_inr(t.amount, true)}) from ${pro.full_name}'s wallet?`)) return
    const res = await fetch(`/api/admin-auth/wallet?txn_id=${t.id}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { alert(json.error || 'Could not remove'); return }
    load(); onChanged()
  }

  const txns = (wallet?.txns ?? []).filter(t => filter === 'all' || (filter === 'in' ? t.amount > 0 : t.amount < 0))

  // group by date
  const groups: { date: string; items: W_Txn[] }[] = []
  txns.forEach(t => {
    const g = groups[groups.length - 1]
    if (g && g.date === t.txn_date) g.items.push(t)
    else groups.push({ date: t.txn_date, items: [t] })
  })

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(15,23,42,0.35)' }} onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-[560px] overflow-y-auto" style={{ background: W_PAGE }}>
        <div className="sticky top-0 z-10 px-5 py-4 flex items-start justify-between gap-3"
          style={{ background: W_CARD, borderBottom: `1px solid ${W_LINE}` }}>
          <div>
            <p className="text-lg font-black" style={{ color: W_INK }}>{pro.full_name}</p>
            <p className="text-xs" style={{ color: W_FAINT }}>{pro.phone}{wallet?.joined_on && ` · joined ${W_fmtDate(wallet.joined_on)}`}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl text-lg" style={{ background: W_PAGE, color: W_MUTED }}>✕</button>
        </div>

        <div className="p-5">
          {err && <div className="rounded-xl px-4 py-3 mb-4 text-sm font-semibold" style={{ background: W_RED_BG, color: W_RED }}>{err}</div>}
          {!wallet && !err && (
            <div className="py-16 flex justify-center">
              <div className="w-9 h-9 rounded-full border-4 animate-spin" style={{ borderColor: W_CYAN[100], borderTopColor: W_CYAN[600] }} />
            </div>
          )}

          {wallet && (
            <>
              {/* balance card */}
              <div className="rounded-2xl p-5 mb-4" style={{ background: `linear-gradient(135deg, ${W_CYAN[600]}, ${W_CYAN[700]})`, color: '#fff' }}>
                <p className="text-xs font-semibold opacity-80">
                  {wallet.balance < 0 ? 'Advance to be adjusted from next earnings' : 'Balance due'}
                </p>
                <p className="text-3xl font-black mt-1">{W_inr(Math.abs(wallet.balance))}</p>
                {W_n((wallet as any).total_advance) > 0 && (
                  <p className="text-[11px] opacity-80 mt-1">Advances given so far: {W_inr(W_n((wallet as any).total_advance))}</p>
                )}
                <div className="grid grid-cols-3 gap-3 mt-4 text-xs">
                  <div><p className="opacity-75">Total earned</p><p className="font-black text-sm">{W_inr(wallet.total_earned)}</p></div>
                  <div><p className="opacity-75">Total paid</p><p className="font-black text-sm">{W_inr(wallet.total_paid)}</p></div>
                  <div><p className="opacity-75">This month</p><p className="font-black text-sm">+{W_inr(wallet.month_earned)} / −{W_inr(wallet.month_paid)}</p></div>
                </div>
              </div>

              {/* today so far */}
              {wallet.today && (W_n(wallet.today.amount) !== 0 || W_n(wallet.today.orders_count) > 0) && (
                <div className="rounded-2xl p-4 mb-4" style={{ background: W_CARD, border: `1px dashed ${W_CYAN[500]}66` }}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold" style={{ color: W_INK }}>⏳ Today so far</p>
                    <p className="text-sm font-black" style={{ color: W_CYAN[700] }}>{W_inr(W_n(wallet.today.amount))}</p>
                  </div>
                  <p className="text-[11px] mt-1" style={{ color: W_FAINT }}>Added to the balance tonight after the day ends</p>
                </div>
              )}

              {/* actions */}
              {isOwner && (
                <div className="flex gap-2 flex-wrap mb-4">
                  {([
                    ['payout', '💸 Record payout', W_CYAN[600]],
                    ['advance', '⏩ Give advance', '#D97706'],
                    ['deduction', '➖ Deduction', W_RED],
                    ['credit', '➕ Credit', W_GREEN],
                    ['opening_balance', '📘 Opening balance', W_MUTED],
                  ] as [W_EntryKind, string, string][]).map(([k, label, color]) => (
                    <button key={k} onClick={() => setForm(form === k ? null : k)}
                      className="px-3 py-2 rounded-xl text-xs font-black transition-all"
                      style={form === k
                        ? { background: color, color: '#fff' }
                        : { background: W_CARD, color, border: `1px solid ${color}44` }}>
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {form && (
                <div className="rounded-2xl p-4 mb-4" style={{ background: W_CARD, border: `1px solid ${W_LINE}` }}>
                  <W_EntryForm workerId={pro.worker_id} kind={form}
                    suggested={form === 'payout' ? Math.max(0, wallet.balance) : undefined}
                    onDone={() => { setForm(null); load(); onChanged() }}
                    onCancel={() => setForm(null)} />
                </div>
              )}

              {/* filter */}
              <div className="flex gap-2 mb-3">
                {([['all', 'All'], ['in', '🟢 Added'], ['out', '🔴 Taken out']] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setFilter(k)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold"
                    style={filter === k
                      ? { background: W_CYAN[50], color: W_CYAN[700], border: `1px solid ${W_CYAN[500]}55` }
                      : { background: W_CARD, color: W_MUTED, border: `1px solid ${W_LINE}` }}>
                    {l}
                  </button>
                ))}
              </div>

              {/* history */}
              {groups.length === 0 && (
                <p className="text-center py-10 text-sm" style={{ color: W_FAINT }}>No entries yet</p>
              )}
              <div className="space-y-4">
                {groups.map(g => (
                  <div key={g.date}>
                    <p className="text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: W_FAINT }}>
                      {new Date(g.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                    <div className="space-y-2">
                      {g.items.map(t => <W_TxnRow key={t.id} t={t} canRemove={isOwner && t.editable} onRemove={() => remove(t)} />)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

/* ───────────────────────── one history line ───────────────────────── */
function W_TxnRow({ t, canRemove, onRemove }: { t: W_Txn; canRemove: boolean; onRemove: () => void }) {
  const [open, setOpen] = useState(false)
  const inFlow = t.amount >= 0
  const hasDetail = t.kind === 'daily_earning' && !!t.breakdown
  const b = t.breakdown ?? {}

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: W_CARD, border: `1px solid ${W_LINE}` }}>
      <button onClick={() => hasDetail && setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-left"
        style={{ cursor: hasDetail ? 'pointer' : 'default' }}>
        <span className="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0"
          style={{ background: inFlow ? W_GREEN_BG : W_RED_BG }}>{W_KIND_ICON[t.kind] ?? '•'}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold truncate" style={{ color: W_INK }}>{t.title}</span>
          <span className="block text-[11px] truncate" style={{ color: W_FAINT }}>
            {t.kind === 'payout' || t.kind === 'advance'
              ? [t.method?.toUpperCase(), t.reference && `Ref ${t.reference}`, t.note].filter(Boolean).join(' · ') || 'Paid'
              : t.note || (t.kind === 'daily_earning' ? `${W_n(b.shift_hours)} h shift · ${W_n(b.order_hours)} h orders` : '')}
          </span>
        </span>
        <span className="text-sm font-black whitespace-nowrap" style={{ color: inFlow ? W_GREEN : W_RED }}>
          {W_inr(t.amount, true)}
        </span>
        {hasDetail && <span className="text-xs" style={{ color: W_FAINT }}>{open ? '▴' : '▾'}</span>}
      </button>

      {open && hasDetail && (
        <div className="px-4 pb-3 pt-1" style={{ borderTop: `1px dashed ${W_LINE}` }}>
          <W_BreakdownTable b={b} />
        </div>
      )}

      {canRemove && (
        <div className="px-3.5 pb-2 -mt-1 text-right">
          <button onClick={onRemove} className="text-[11px] font-bold" style={{ color: W_RED }}>Remove</button>
        </div>
      )}
    </div>
  )
}

function W_BreakdownTable({ b }: { b: W_Breakdown }) {
  const lines: [string, number][] = [
    [`Base pay (${W_n(b.shift_hours)} h on shift)`, W_n(b.base_amount)],
    [`Order pay (${W_n(b.orders_count)} ${W_n(b.orders_count) === 1 ? 'order' : 'orders'} · ${W_n(b.order_hours)} h)`, W_n(b.order_amount)],
    ...(W_n(b.overtime_amount) ? [[`Overtime (${W_n(b.overtime_hours)} h)`, W_n(b.overtime_amount)] as [string, number]] : []),
    [`Travel allowance`, W_n(b.travel_amount)],
    ...(W_n(b.penalty_amount) ? [[`Leave penalty`, -W_n(b.penalty_amount)] as [string, number]] : []),
  ]
  return (
    <div className="text-xs">
      {lines.map(([label, v]) => (
        <div key={label} className="flex justify-between py-1" style={{ color: W_BODY }}>
          <span>{label}</span><span className="font-semibold" style={{ color: v < 0 ? W_RED : W_INK }}>{W_inr(v)}</span>
        </div>
      ))}
      <div className="flex justify-between py-1.5 mt-1 font-black" style={{ borderTop: `1px solid ${W_LINE}`, color: W_INK }}>
        <span>Total</span><span>{W_inr(W_n(b.amount))}</span>
      </div>
      {(b.orders ?? []).length > 0 && (
        <div className="mt-2 rounded-lg p-2.5" style={{ background: W_PAGE }}>
          <p className="font-bold mb-1" style={{ color: W_MUTED }}>Orders</p>
          {(b.orders ?? []).map(o => (
            <div key={o.booking_id} className="flex justify-between py-0.5" style={{ color: W_BODY }}>
              <span>{o.time} · {o.service}</span>
              <span style={{ color: W_FAINT }}>{o.minutes} min · #{String(o.booking_id).slice(0, 8)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ───────────────────────── add entry form ───────────────────────── */
function W_EntryForm({ workerId, kind, suggested, onDone, onCancel }: {
  workerId: string; kind: W_EntryKind; suggested?: number; onDone: () => void; onCancel: () => void
}) {
  const [amount, setAmount] = useState(suggested && suggested > 0 ? String(Math.round(suggested * 100) / 100) : '')
  const [date, setDate] = useState(W_todayIST())
  const [method, setMethod] = useState('upi')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const label = kind === 'payout' ? 'Record payout' : kind === 'advance' ? 'Record advance' : kind === 'deduction' ? 'Add deduction'
    : kind === 'credit' ? 'Add credit' : 'Set opening balance'

  async function save() {
    setErr(null)
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) { setErr('Enter an amount'); return }
    if ((kind === 'deduction' || kind === 'credit') && !note.trim()) { setErr('Please write a reason'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/admin-auth/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: workerId, kind, amount: amt, date, method: kind === 'payout' || kind === 'advance' ? method : null, reference, note }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not save')
      onDone()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full px-3 py-2.5 rounded-xl text-sm outline-none'
  const inputStyle = { background: W_PAGE, border: `1px solid ${W_LINE}`, color: W_INK }

  return (
    <div className="space-y-3">
      {kind === 'opening_balance' && (
        <p className="text-xs" style={{ color: W_MUTED }}>
          Use this if the professional was already owed money before this wallet started (e.g. unpaid salary settled outside).
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-bold" style={{ color: W_MUTED }}>Amount (₹)</span>
          <input type="number" min={1} value={amount} onChange={e => setAmount(e.target.value)} className={input} style={inputStyle} />
        </label>
        <label className="block">
          <span className="text-xs font-bold" style={{ color: W_MUTED }}>Date</span>
          <input type="date" value={date} max={W_todayIST()} onChange={e => setDate(e.target.value)} className={input} style={inputStyle} />
        </label>
      </div>

      {kind === 'advance' && (
        <p className="text-xs" style={{ color: W_MUTED }}>
          Money given in between when the professional asks. It shows in red in her wallet and is
          adjusted automatically from her next earnings.
        </p>
      )}
      {(kind === 'payout' || kind === 'advance') && (
        <>
          <div>
            <span className="text-xs font-bold" style={{ color: W_MUTED }}>Paid via</span>
            <div className="flex gap-2 mt-1">
              {[['upi', 'UPI'], ['bank', 'Bank transfer'], ['cash', 'Cash']].map(([k, l]) => (
                <button key={k} onClick={() => setMethod(k)}
                  className="px-3 py-2 rounded-xl text-xs font-bold"
                  style={method === k ? { background: W_CYAN[600], color: '#fff' } : { background: W_PAGE, color: W_BODY, border: `1px solid ${W_LINE}` }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {method !== 'cash' && (
            <label className="block">
              <span className="text-xs font-bold" style={{ color: W_MUTED }}>Reference / UTR no. (optional)</span>
              <input value={reference} onChange={e => setReference(e.target.value)} className={input} style={inputStyle} />
            </label>
          )}
        </>
      )}

      <label className="block">
        <span className="text-xs font-bold" style={{ color: W_MUTED }}>
          {kind === 'deduction' || kind === 'credit' ? 'Reason (shown to the professional)' : kind === 'advance' ? 'Why she asked (optional, shown to her)' : 'Note (optional)'}
        </span>
        <input value={note} onChange={e => setNote(e.target.value)} className={input} style={inputStyle}
          placeholder={kind === 'advance' ? 'e.g. Asked for medical emergency' : kind === 'deduction' ? 'e.g. Late penalty' : kind === 'credit' ? 'e.g. Extra travel for far job' : ''} />
      </label>

      {err && <p className="text-xs font-semibold" style={{ color: W_RED }}>{err}</p>}

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-bold" style={{ color: W_MUTED }}>Cancel</button>
        <button onClick={save} disabled={busy}
          className="px-4 py-2 rounded-xl text-sm font-black text-white disabled:opacity-50"
          style={{ background: kind === 'deduction' ? W_RED : kind === 'credit' ? W_GREEN : kind === 'advance' ? '#D97706' : W_CYAN[600] }}>
          {busy ? 'Saving…' : label}
        </button>
      </div>
      {kind === 'payout' && (
        <p className="text-[11px]" style={{ color: W_FAINT }}>
          This only records a payment you already made. The professional gets a notification and sees it in red in their wallet.
        </p>
      )}
    </div>
  )
}

/* ───────────────────────── modal ───────────────────────── */
function W_Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(15,23,42,0.35)' }} onClick={onClose} />
      <div className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-md rounded-2xl p-5"
        style={{ background: W_CARD, boxShadow: '0 20px 50px rgba(15,23,42,0.25)' }}>
        <div className="flex items-center justify-between mb-4">
          <p className="font-black" style={{ color: W_INK }}>{title}</p>
          <button onClick={onClose} className="text-lg" style={{ color: W_MUTED }}>✕</button>
        </div>
        {children}
      </div>
    </>
  )
}

// ─────────────────────────── TIERS & BONUS (MONTHLY) ───────────────────────────
// Tier = orders completed in the chosen month (Indian time). Everyone
// starts again from zero on the 1st. Tier bonus goes into the wallet the
// day it's earned; on the 1st, last month's rewards turn "Settled".
type T_Cfg = { tier: string; rank: number; min_orders: number; bonus_amount: number; label?: string | null }

function T_monthKeyIst(d = new Date()) {
  const ist = new Date(d.getTime() + (330 + d.getTimezoneOffset()) * 60000)
  return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}`
}
function T_monthLabel(k: string) {
  return new Date(k + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}
function T_cap(t?: string | null) { return t ? t[0].toUpperCase() + t.slice(1) : 'New' }

function TiersTab() {
  const supabase = createClient()
  const thisMonth = T_monthKeyIst()
  const months = useMemo(() => {
    const out: string[] = []
    const [y, m] = thisMonth.split('-').map(Number)
    for (let i = 0; i < 6; i++) {
      const d = new Date(y, m - 1 - i, 1)
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    return out
  }, [thisMonth])
  const [month, setMonth] = useState(thisMonth)
  const [loading, setLoading] = useState(true)
  const [cfg, setCfg] = useState<T_Cfg[]>([])
  const [rows, setRows] = useState<{ id: string; name: string; phone: string; orders: number; tierBonus: number; tierStatus: string; manual: number; reached: string | null }[]>([])
  const [sort, setSort] = useState<'orders' | 'bonus' | 'name'>('orders')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [y, m] = month.split('-').map(Number)
      // month window in IST, as UTC instants
      const fromUtc = new Date(Date.UTC(y, m - 1, 1) - 330 * 60000).toISOString()
      const toUtc = new Date(Date.UTC(y, m, 1) - 330 * 60000).toISOString()
      const [{ data: cfgRows }, { data: users }, { data: bk }, { data: tr }, { data: mb }] = await Promise.all([
        supabase.from('tier_config').select('*'),
        supabase.from('users').select('id,full_name,phone,is_active').eq('role', 'worker'),
        supabase.from('bookings').select('worker_id,work_ended_at,scheduled_at')
          .eq('status', 'completed')
          .gte('scheduled_at', new Date(Date.parse(fromUtc) - 3 * 86400000).toISOString())
          .lt('scheduled_at', new Date(Date.parse(toUtc) + 86400000).toISOString()),
        supabase.from('tier_rewards').select('worker_id,tier,bonus_amount,status,period,earned_at'),
        supabase.from('worker_manual_bonuses').select('worker_id,amount,status,created_at')
          .gte('created_at', fromUtc).lt('created_at', toUtc),
      ]) as any[]

      const conf: T_Cfg[] = (cfgRows ?? []).filter((c: any) => c.tier !== 'new')
        .sort((a: any, b: any) => (a.min_orders ?? 0) - (b.min_orders ?? 0))
      setCfg(conf)

      const count: Record<string, number> = {}
      for (const b of (bk ?? [])) {
        const t = Date.parse(b.work_ended_at ?? b.scheduled_at)
        if (t >= Date.parse(fromUtc) && t < Date.parse(toUtc) && b.worker_id) count[b.worker_id] = (count[b.worker_id] ?? 0) + 1
      }
      const tb: Record<string, { amt: number; earned: number; best: string | null; bestRank: number }> = {}
      for (const r of (tr ?? [])) {
        const p = String(r.period ?? r.earned_at ?? '').slice(0, 7)
        if (p !== month || r.status === 'rejected') continue
        const e = (tb[r.worker_id] ??= { amt: 0, earned: 0, best: null, bestRank: -1 })
        e.amt += Number(r.bonus_amount ?? 0)
        if (r.status === 'earned') e.earned += Number(r.bonus_amount ?? 0)
        const rank = conf.findIndex(c => c.tier === r.tier)
        if (rank > e.bestRank) { e.bestRank = rank; e.best = r.tier }
      }
      const man: Record<string, number> = {}
      for (const b of (mb ?? [])) if (b.status !== 'rejected') man[b.worker_id] = (man[b.worker_id] ?? 0) + Number(b.amount ?? 0)

      setRows((users ?? []).filter((u: any) => u.is_active !== false || count[u.id] || tb[u.id]).map((u: any) => {
        const n = count[u.id] ?? 0
        const reached = conf.filter(c => n >= c.min_orders).slice(-1)[0]?.tier ?? tb[u.id]?.best ?? null
        const t = tb[u.id]
        return {
          id: u.id, name: u.full_name ?? '—', phone: u.phone ?? '',
          orders: n, reached,
          tierBonus: t?.amt ?? 0,
          tierStatus: !t ? '' : t.earned > 0 ? 'In wallet' : 'Settled',
          manual: man[u.id] ?? 0,
        }
      }))
    } catch { setRows([]) } finally { setLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])
  useEffect(() => { load() }, [load])

  const sorted = [...rows].sort((a, b) =>
    sort === 'name' ? a.name.localeCompare(b.name)
    : sort === 'bonus' ? (b.tierBonus + b.manual) - (a.tierBonus + a.manual)
    : b.orders - a.orders)
  const totTier = rows.reduce((s, r) => s + r.tierBonus, 0)
  const totManual = rows.reduce((s, r) => s + r.manual, 0)
  const reachedCount = rows.filter(r => r.reached).length
  const isCurrent = month === thisMonth
  const istNow = new Date(Date.now() + (330 + new Date().getTimezoneOffset()) * 60000)
  const daysLeft = new Date(istNow.getFullYear(), istNow.getMonth() + 1, 0).getDate() - istNow.getDate()
  const nextReset = new Date(istNow.getFullYear(), istNow.getMonth() + 1, 1).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  const tierColor: Record<number, string> = { 0: '#B45309', 1: '#64748B', 2: '#CA8A04', 3: '#7C3AED', 4: '#0891B2' }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="inline-flex p-1 rounded-xl bg-slate-100 overflow-x-auto max-w-full">
          {months.map(k => (
            <button key={k} onClick={() => setMonth(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${month === k ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-500'}`}>
              {k === thisMonth ? 'This month' : new Date(k + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-400 ml-auto">
          {isCurrent ? <>🔄 Tiers restart from zero on <b className="text-slate-600">{nextReset}</b> · {daysLeft} day{daysLeft === 1 ? '' : 's'} left</> : <>{T_monthLabel(month)} · closed</>}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { l: 'Tier bonus', v: inr(totTier), c: '#059669', s: isCurrent ? 'in wallets, settles on the 1st' : 'settled' },
          { l: 'Manual bonus', v: inr(totManual), c: '#DB2777', s: 'given this month' },
          { l: 'Reached a tier', v: `${reachedCount}`, c: '#7C3AED', s: `of ${rows.length} professionals` },
          { l: 'Orders done', v: `${rows.reduce((s, r) => s + r.orders, 0)}`, c: '#0891B2', s: T_monthLabel(month) },
        ].map(g => (
          <div key={g.l} className="rounded-xl bg-white border border-slate-200 p-3">
            <p className="text-[11px] text-slate-500 font-semibold">{g.l}</p>
            <p className="text-lg font-black mt-0.5" style={{ color: g.c }}>{g.v}</p>
            <p className="text-[10px] text-slate-400">{g.s}</p>
          </div>
        ))}
      </div>

      {cfg.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {cfg.map((c, i) => (
            <span key={c.tier} className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-white border border-slate-200" style={{ color: tierColor[i] ?? '#334155' }}>
              🏆 {c.label || T_cap(c.tier)} · {c.min_orders} orders · {inr(c.bonus_amount)}
            </span>
          ))}
        </div>
      )}

      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
          <p className="text-xs font-black text-slate-700">{T_monthLabel(month)} · professionals</p>
          <div className="inline-flex gap-1">
            {(['orders', 'bonus', 'name'] as const).map(k => (
              <button key={k} onClick={() => setSort(k)}
                className={`px-2 py-1 rounded-md text-[11px] font-bold ${sort === k ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-500'}`}>
                {k === 'orders' ? 'Most orders' : k === 'bonus' ? 'Most bonus' : 'Name'}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <div className="px-4 py-10 text-center text-slate-400 text-sm">Loading…</div>
        ) : sorted.length === 0 ? (
          <div className="px-4 py-10 text-center text-slate-400 text-sm">No professionals found.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {sorted.map(r => {
              const idx = cfg.findIndex(c => c.tier === r.reached)
              const next = cfg.find(c => r.orders < c.min_orders) ?? null
              const prevMin = idx >= 0 ? cfg[idx].min_orders : 0
              const pct = next ? Math.max(3, Math.min(100, ((r.orders - prevMin) / Math.max(1, next.min_orders - prevMin)) * 100)) : 100
              return (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black text-sm shrink-0"
                    style={{ background: 'linear-gradient(135deg,#0891B2,#4F46E5)' }}>{r.name[0]?.toUpperCase()}</div>
                  <div className="min-w-0 w-40 shrink-0">
                    <p className="text-[13px] font-bold text-slate-800 truncate">{r.name}</p>
                    <p className="text-[11px] font-black" style={{ color: idx >= 0 ? (tierColor[idx] ?? '#334155') : '#94A3B8' }}>
                      {idx >= 0 ? `🏆 ${cfg[idx].label || T_cap(r.reached)}` : 'No tier yet'}
                    </p>
                  </div>
                  <div className="flex-1 min-w-0 hidden sm:block">
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#0891B2,#7C3AED)' }} />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      {r.orders} order{r.orders === 1 ? '' : 's'}
                      {next ? ` · ${next.min_orders - r.orders} more to ${next.label || T_cap(next.tier)}` : cfg.length ? ' · top tier 🎉' : ''}
                    </p>
                  </div>
                  <p className="sm:hidden text-[12px] font-black text-slate-700">{r.orders}</p>
                  <div className="text-right w-28 shrink-0">
                    {r.tierBonus > 0
                      ? <><p className="text-[13px] font-black text-emerald-600">{inr(r.tierBonus)}</p>
                          <p className="text-[10px] font-bold" style={{ color: r.tierStatus === 'Settled' ? '#15803D' : '#0E7490' }}>{r.tierStatus}</p></>
                      : <p className="text-[12px] text-slate-300">—</p>}
                  </div>
                  <div className="text-right w-24 shrink-0 hidden md:block">
                    {r.manual > 0
                      ? <><p className="text-[13px] font-black text-pink-600">{inr(r.manual)}</p><p className="text-[10px] text-slate-400">manual</p></>
                      : <p className="text-[12px] text-slate-300">—</p>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <p className="text-[11px] text-slate-400 mt-3">
        Tier = orders completed in that month. Tier bonus is added to the professional&apos;s wallet the same day she reaches a tier;
        on the 1st, last month&apos;s tier bonuses are marked settled and everyone&apos;s tier starts again from zero.
      </p>
    </div>
  )
}
