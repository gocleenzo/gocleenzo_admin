'use client'

import { useEffect, useState, useCallback } from 'react'

type Row = {
  id: string
  referrer: string; referrer_phone: string
  referred: string; referred_phone: string
  code: string | null
  status: string
  jobs: number
  amount: number
  earned_at: string | null
  paid_at: string | null
  created_at: string
}

const inr = (n: number) =>
  '₹' + (n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

const STATUS: Record<string, { bg: string; fg: string; label: string }> = {
  joined:   { bg: '#fef3c7', fg: '#b45309', label: 'Joined' },
  earned:   { bg: '#dcfce7', fg: '#15803d', label: 'Earned' },
  paid:     { bg: '#dbeafe', fg: '#1d4ed8', label: 'Paid' },
  rejected: { bg: '#fee2e2', fg: '#b91c1c', label: 'Rejected' },
}

export default function AdminReferralsPage() {
  const [filter, setFilter] = useState<'earned' | 'joined' | 'paid' | 'rejected' | 'all'>('earned')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [totals, setTotals] = useState({ earned: 0, paid: 0 })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/referrals?status=${filter}`, { cache: 'no-store' })
      const j = await res.json()
      setRows(j.rows ?? [])
      setTotals({ earned: j.totalEarned ?? 0, paid: j.totalPaid ?? 0 })
    } catch { setRows([]) } finally { setLoading(false) }
  }, [filter])

  useEffect(() => { load() }, [load])

  async function act(id: string, action: 'pay' | 'reject') {
    if (action === 'reject' && !window.confirm('Reject this referral reward?')) return
    setBusy(id)
    try {
      await fetch('/api/referrals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      })
      await load()
    } finally { setBusy(null) }
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-black text-slate-900">Refer &amp; Earn</h1>
        <p className="text-sm text-slate-500">Referral rewards — approve and pay</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <p className="text-[11px] font-bold text-slate-400 uppercase">Rewards to pay</p>
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

      <div className="inline-flex p-1 rounded-xl bg-slate-100 mb-4 flex-wrap">
        {(['earned', 'joined', 'paid', 'rejected', 'all'] as const).map((f) => (
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
          <p className="text-xs text-slate-400 mt-1">Referral activity appears here.</p>
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
                  <th className="px-3 py-2.5 font-bold text-right">Reward ×2</th>
                  <th className="px-3 py-2.5 font-bold">Status</th>
                  <th className="px-4 py-2.5 font-bold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const s = STATUS[r.status] ?? STATUS.joined
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5">
                        <span className="font-bold text-slate-800">{r.referrer}</span>
                        <span className="block text-[11px] text-slate-400">{r.referrer_phone}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-bold text-slate-800">{r.referred}</span>
                        <span className="block text-[11px] text-slate-400">{r.referred_phone}</span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[12px] text-violet-700">{r.code ?? '—'}</td>
                      <td className="px-3 py-2.5 text-center text-slate-600">{r.jobs}</td>
                      <td className="px-3 py-2.5 text-right font-black text-slate-900">
                        {inr(r.amount)} <span className="text-[10px] text-slate-400">each</span>
                      </td>
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

      <p className="text-[11px] text-slate-400 mt-3">
        &quot;Reward ×2&quot; is paid to both the referrer and the referred worker. Marking paid records both.
      </p>
    </div>
  )
}