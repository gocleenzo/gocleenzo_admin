'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

// ============================================================================
// Admin Recurring Packages page
// ============================================================================
// Everything here already lives in the database (recurring_packages +
// recurring_package_days, each day linked to a normal `bookings` row) —
// this page is purely a dedicated view/management layer on top of data
// that was already being written correctly by the customer app's
// checkout flow. Nothing new is stored here that wasn't already there.
// ============================================================================

type PackageRow = {
  id: string
  customer_id: string
  worker_id: string | null
  address_id: string
  service_id: string
  start_date: string
  end_date: string
  standard_time: string
  duration_minutes: number
  price_per_visit: number
  total_visits: number
  total_amount: number
  payment_status: string
  status: string
  special_instructions: string | null
  created_at: string
  // joined
  customer_name: string
  customer_phone: string
  worker_name: string
  service_name: string
  area: string
  activeDays: number
  forfeitedDays: number
  completedDays: number
}

type DayRow = {
  id: string
  booking_id: string
  day_number: number
  scheduled_at: string
  is_alternate_time: boolean
  status: string
}

type Worker = { id: string; name: string; phone: string }

const STATUS_CFG: Record<string, { bg: string; fg: string; label: string }> = {
  active:    { bg: '#DBEAFE', fg: '#2563EB', label: 'Active' },
  completed: { bg: '#D1FAE5', fg: '#059669', label: 'Completed' },
  cancelled: { bg: '#FEE2E2', fg: '#DC2626', label: 'Cancelled' },
}

export default function AdminRecurringPackages() {
  const [packages, setPackages] = useState<PackageRow[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed' | 'cancelled'>('active')
  const [expanded, setExpanded] = useState<PackageRow | null>(null)
  const supabase = createClient()

  const load = useCallback(async () => {
    const [{ data: pkgs }, { data: wd }] = await Promise.all([
      supabase
        .from('recurring_packages')
        .select(`
          id, customer_id, worker_id, address_id, service_id, start_date, end_date,
          standard_time, duration_minutes, price_per_visit, total_visits, total_amount,
          payment_status, status, special_instructions, created_at,
          customer:users!customer_id(full_name, phone),
          worker:users!worker_id(full_name),
          service:services(name),
          address:addresses(area)
        `)
        .order('created_at', { ascending: false }),
      supabase.from('users').select('id, full_name, phone').eq('role', 'worker').order('full_name'),
    ])

    if (wd) setWorkers(wd.map((w: any) => ({ id: w.id, name: w.full_name ?? 'Unknown', phone: w.phone ?? '' })))

    if (pkgs) {
      // Pull day-status counts for all packages in one query rather than
      // N+1 — grouped client-side since Supabase's JS client doesn't do
      // GROUP BY directly.
      const { data: allDays } = await supabase
        .from('recurring_package_days')
        .select('package_id, status')
        .in('package_id', pkgs.map((p: any) => p.id))

      const dayCounts: Record<string, { active: number; forfeited: number; completed: number }> = {}
      ;(allDays ?? []).forEach((d: any) => {
        if (!dayCounts[d.package_id]) dayCounts[d.package_id] = { active: 0, forfeited: 0, completed: 0 }
        if (d.status === 'scheduled') dayCounts[d.package_id].active++
        else if (d.status === 'cancelled_forfeited') dayCounts[d.package_id].forfeited++
        else if (d.status === 'completed') dayCounts[d.package_id].completed++
      })

      setPackages(pkgs.map((p: any) => ({
        id: p.id,
        customer_id: p.customer_id,
        worker_id: p.worker_id,
        address_id: p.address_id,
        service_id: p.service_id,
        start_date: p.start_date,
        end_date: p.end_date,
        standard_time: p.standard_time,
        duration_minutes: p.duration_minutes,
        price_per_visit: p.price_per_visit,
        total_visits: p.total_visits,
        total_amount: p.total_amount,
        payment_status: p.payment_status,
        status: p.status,
        special_instructions: p.special_instructions,
        created_at: p.created_at,
        customer_name: p.customer?.full_name ?? 'Customer',
        customer_phone: p.customer?.phone ?? '—',
        worker_name: p.worker?.full_name ?? 'Unassigned',
        service_name: p.service?.name ?? 'Service',
        area: p.address?.area ?? '—',
        activeDays: dayCounts[p.id]?.active ?? 0,
        forfeitedDays: dayCounts[p.id]?.forfeited ?? 0,
        completedDays: dayCounts[p.id]?.completed ?? 0,
      })))
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = packages.filter(p => {
    const matchSearch = p.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      p.customer_phone.includes(search) ||
      p.worker_name.toLowerCase().includes(search.toLowerCase()) ||
      p.service_name.toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'all' || p.status === statusFilter
    return matchSearch && matchStatus
  })

  const activeCount = packages.filter(p => p.status === 'active').length
  const totalRevenue = packages.filter(p => p.payment_status === 'paid').reduce((s, p) => s + p.total_amount, 0)

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin border-slate-200"
        style={{ borderTopColor: '#7C3AED' }}/>
    </div>
  )

  return (
    <div className="min-h-screen px-4 md:px-8 py-7 bg-slate-50">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl"
            style={{ background: '#7C3AED14', border: '1px solid #7C3AED25' }}>🔁</div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 leading-tight tracking-tight">Recurring Packages</h1>
            <p className="text-xs text-slate-400 font-medium">
              {packages.length} total · {activeCount} active · ₹{totalRevenue.toLocaleString('en-IN')} collected
            </p>
          </div>
        </div>
        <input type="text" placeholder="Search customer, worker, service…" value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-4 py-2.5 rounded-xl text-sm text-slate-800 placeholder-slate-400 outline-none bg-white border border-slate-200 w-full md:w-72"/>
      </div>

      {/* status pills */}
      <div className="flex gap-2 overflow-x-auto pb-3 mb-4">
        {(['active', 'completed', 'cancelled', 'all'] as const).map(s => {
          const count = s === 'all' ? packages.length : packages.filter(p => p.status === s).length
          const cfg = s === 'all' ? { bg: '#EDE9FE', fg: '#7C3AED', label: 'All' } : STATUS_CFG[s]
          const on = statusFilter === s
          return (
            <button key={s} onClick={() => setStatusFilter(s)}
              className="px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all"
              style={{
                background: on ? cfg.bg : '#fff',
                color: on ? cfg.fg : '#64748B',
                border: `1px solid ${on ? cfg.fg + '40' : '#E2E8F0'}`,
              }}>
              {cfg.label} ({count})
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center shadow-sm">
          <p className="text-4xl mb-3">🔁</p>
          <p className="text-slate-700 font-bold">No recurring packages found</p>
          <p className="text-sm text-slate-400 mt-1">
            {search ? (
              <button onClick={() => setSearch('')} className="text-violet-600 font-bold hover:underline">
                Clear search
              </button>
            ) : 'Packages appear here once a customer books a weekly package.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  {['Customer', 'Service', 'Worker', 'Dates', 'Days', 'Amount', 'Status', ''].map(c => (
                    <th key={c} className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wide whitespace-nowrap">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const cfg = STATUS_CFG[p.status] ?? STATUS_CFG.active
                  return (
                    <tr key={p.id}
                      onClick={() => setExpanded(p)}
                      className="border-b border-slate-50 hover:bg-slate-50/70 transition-colors cursor-pointer">
                      <td className="px-4 py-3.5">
                        <p className="font-bold text-[13px] text-slate-800">{p.customer_name}</p>
                        <p className="text-[11px] text-slate-400">{p.customer_phone} · {p.area}</p>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-[13px] font-semibold text-slate-700">{p.service_name}</p>
                        <p className="text-[11px] text-slate-400">{p.standard_time} · {p.duration_minutes} min</p>
                      </td>
                      <td className="px-4 py-3.5">
                        {p.worker_id ? (
                          <span className="text-[12px] font-semibold text-slate-700">{p.worker_name}</span>
                        ) : (
                          <span className="text-[11px] text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <p className="text-[12px] text-slate-700">
                          {new Date(p.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          {' → '}
                          {new Date(p.end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </p>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-bold text-blue-600">{p.activeDays} left</span>
                          {p.completedDays > 0 && <span className="text-[11px] text-green-600">· {p.completedDays} done</span>}
                          {p.forfeitedDays > 0 && <span className="text-[11px] text-red-500">· {p.forfeitedDays} forfeited</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="text-[13px] font-black text-violet-700">₹{p.total_amount.toLocaleString('en-IN')}</span>
                        <p className="text-[10px] text-slate-400">{p.payment_status === 'paid' ? '✓ Paid' : p.payment_status}</p>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="text-[11px] font-bold px-2 py-1 rounded-full whitespace-nowrap"
                          style={{ background: cfg.bg, color: cfg.fg }}>
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <span className="text-[11px] font-bold text-violet-700 bg-violet-50 px-2.5 py-1 rounded-lg border border-violet-200">
                          View
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {expanded && (
        <PackageDetailModal
          pkg={expanded}
          workers={workers}
          onClose={() => setExpanded(null)}
          onSaved={() => { setExpanded(null); load() }}
        />
      )}
    </div>
  )
}

// ── Package Detail + Reassign Worker Modal ──────────────────────
function PackageDetailModal({ pkg, workers, onClose, onSaved }: {
  pkg: PackageRow
  workers: Worker[]
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const [days, setDays] = useState<DayRow[]>([])
  const [loadingDays, setLoadingDays] = useState(true)
  const [reassignOpen, setReassignOpen] = useState(false)
  const [newWorkerId, setNewWorkerId] = useState('')
  const [reassigning, setReassigning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('recurring_package_days')
      .select('*').eq('package_id', pkg.id).order('day_number')
      .then(({ data }) => { setDays((data ?? []) as DayRow[]); setLoadingDays(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkg.id])

  async function reassign() {
    if (!newWorkerId) return
    setReassigning(true)
    setError(null)
    setSuccess(null)
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_reassign_recurring_worker', {
        p_package_id: pkg.id,
        p_new_worker_id: newWorkerId,
      })
      if (rpcError) { setError(rpcError.message); setReassigning(false); return }
      if (!data?.success) {
        const reasonMap: Record<string, string> = {
          package_not_found: 'Package not found.',
          worker_not_found: 'Selected worker not found.',
          no_remaining_days: 'No remaining scheduled days to reassign — the package is already finished.',
          new_worker_not_free: 'This worker is not free at the remaining time slots. Try a different worker.',
        }
        setError(reasonMap[data?.reason] ?? (data?.message || 'Could not reassign worker.'))
        setReassigning(false)
        return
      }
      setSuccess(`✓ Reassigned ${data.days_reassigned} remaining day(s) to the new worker.`)
      setReassigning(false)
      setTimeout(onSaved, 1200)
    } catch (e: any) {
      setError(e?.message ?? 'Could not reassign worker.')
      setReassigning(false)
    }
  }

  function dayStatusPill(status: string) {
    const map: Record<string, { bg: string; color: string; label: string }> = {
      scheduled:           { bg: '#DBEAFE', color: '#2563EB', label: 'Scheduled' },
      completed:           { bg: '#D1FAE5', color: '#059669', label: 'Completed' },
      cancelled_forfeited: { bg: '#FEE2E2', color: '#DC2626', label: 'Forfeited' },
    }
    const cfg = map[status] ?? { bg: '#F1F5F9', color: '#64748B', label: status }
    return (
      <span className="text-[10px] font-bold px-2 py-1 rounded-full"
        style={{ background: cfg.bg, color: cfg.color }}>
        {cfg.label}
      </span>
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose}/>
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-black text-slate-800">🔁 Recurring Package</h2>
            <p className="text-xs text-slate-400 mt-0.5">#{pkg.id.slice(0, 8).toUpperCase()}</p>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-xl flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all">✕</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="rounded-2xl p-4 bg-violet-50 border border-violet-200">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-[10px] text-violet-500 font-bold uppercase">Customer</p>
                <p className="font-bold text-slate-800">{pkg.customer_name}</p>
                <p className="text-xs text-slate-500">{pkg.customer_phone}</p>
              </div>
              <div>
                <p className="text-[10px] text-violet-500 font-bold uppercase">Current Worker</p>
                <p className="font-bold text-slate-800">{pkg.worker_name}</p>
              </div>
              <div>
                <p className="text-[10px] text-violet-500 font-bold uppercase">Service</p>
                <p className="font-bold text-slate-800">{pkg.service_name}</p>
              </div>
              <div>
                <p className="text-[10px] text-violet-500 font-bold uppercase">Daily Time</p>
                <p className="font-bold text-slate-800">{pkg.standard_time}</p>
              </div>
            </div>
          </div>

          {/* Reassign worker */}
          {pkg.activeDays > 0 && (
            <div className="rounded-2xl border border-slate-200 overflow-hidden">
              <button onClick={() => setReassignOpen(!reassignOpen)}
                className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-all">
                <span className="text-sm font-bold text-slate-700">
                  👷 {pkg.worker_id ? 'Reassign Worker' : 'Assign Worker'} for remaining {pkg.activeDays} day(s)
                </span>
                <span className="text-slate-400">{reassignOpen ? '−' : '+'}</span>
              </button>
              {reassignOpen && (
                <div className="p-4 space-y-3">
                  <p className="text-[11px] text-slate-500">
                    Only affects days not yet completed or forfeited. The new
                    worker's availability is re-checked against every
                    remaining day before this is applied — if they're not
                    free on even one, nothing changes and you'll see why.
                  </p>
                  <select value={newWorkerId} onChange={e => setNewWorkerId(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200">
                    <option value="">Select worker…</option>
                    {workers.filter(w => w.id !== pkg.worker_id).map(w => (
                      <option key={w.id} value={w.id}>{w.name} — {w.phone}</option>
                    ))}
                  </select>
                  {error && (
                    <div className="rounded-xl px-3 py-2.5 bg-red-50 border border-red-200">
                      <p className="text-xs font-bold text-red-600">{error}</p>
                    </div>
                  )}
                  {success && (
                    <div className="rounded-xl px-3 py-2.5 bg-green-50 border border-green-200">
                      <p className="text-xs font-bold text-green-600">{success}</p>
                    </div>
                  )}
                  <button onClick={reassign} disabled={!newWorkerId || reassigning}
                    className="w-full h-10 rounded-xl font-black text-sm text-white disabled:opacity-40 active:scale-[0.98] transition-all"
                    style={{ background: 'linear-gradient(135deg,#7C3AED,#4F46E5)' }}>
                    {reassigning ? '…' : '✓ Confirm Reassignment'}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl px-3 py-2.5 bg-slate-50 border border-slate-200 text-center">
              <p className="text-lg font-black text-blue-600">{pkg.activeDays}</p>
              <p className="text-[10px] text-slate-400">Remaining</p>
            </div>
            <div className="rounded-xl px-3 py-2.5 bg-slate-50 border border-slate-200 text-center">
              <p className="text-lg font-black text-green-600">{pkg.completedDays}</p>
              <p className="text-[10px] text-slate-400">Completed</p>
            </div>
            <div className="rounded-xl px-3 py-2.5 bg-slate-50 border border-slate-200 text-center">
              <p className="text-lg font-black text-red-500">{pkg.forfeitedDays}</p>
              <p className="text-[10px] text-slate-400">Forfeited</p>
            </div>
          </div>

          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
              All {pkg.total_visits} Visits
            </p>
            {loadingDays ? (
              <div className="py-6 text-center text-slate-400 text-sm">Loading…</div>
            ) : (
              <div className="rounded-2xl border border-slate-200 overflow-hidden divide-y divide-slate-50">
                {days.map(d => {
                  const date = new Date(d.scheduled_at)
                  const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                  const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                  return (
                    <div key={d.id} className="flex items-center justify-between px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-black bg-violet-100 text-violet-700">
                          {d.day_number}
                        </div>
                        <div>
                          <p className="text-[13px] font-bold text-slate-700">{dateStr}</p>
                          <p className="text-[11px] text-slate-400">
                            {timeStr}{d.is_alternate_time ? ' (alternate time)' : ''}
                          </p>
                        </div>
                      </div>
                      {dayStatusPill(d.status)}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {pkg.special_instructions && (
            <div className="rounded-xl px-4 py-3 bg-amber-50 border border-amber-200">
              <p className="text-[10px] font-black uppercase tracking-wider text-amber-600 mb-1">
                Instructions (applies to all visits)
              </p>
              <p className="text-sm text-slate-600">{pkg.special_instructions}</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}