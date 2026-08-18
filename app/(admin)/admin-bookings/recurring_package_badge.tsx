'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// ============================================================================
// RecurringPackageBadge
// ============================================================================
// Drop-in badge for a single booking row in admin-bookings/page.tsx. Looks
// up (once, on mount) whether this booking is part of a recurring weekly
// package via recurring_package_days, and if so shows a small "🔁 Day X/7"
// pill. Clicking it opens a modal with the full 7-day package.
//
// Self-contained and additive by design — this booking row itself doesn't
// need any new fields threaded through from the parent query. It fetches
// its own tiny lookup (a single row keyed by booking_id), so dropping this
// into the existing table doesn't require touching the big Booking type
// or the main load() query at all.
//
// USAGE — add this import to admin-bookings/page.tsx:
//   import RecurringPackageBadge from './recurring_package_badge'
//
// Then in the table row where other badges live (next to the "📞 Phone"
// badge for is_manual_booking, inside the Service/Customer <td>), add:
//   <RecurringPackageBadge bookingId={b.id} />
// ============================================================================

type PackageDayInfo = {
  package_id: string
  day_number: number
  status: string
}

export default function RecurringPackageBadge({ bookingId }: { bookingId: string }) {
  const [info, setInfo] = useState<PackageDayInfo | null>(null)
  const [showModal, setShowModal] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    let cancelled = false
    supabase
      .from('recurring_package_days')
      .select('package_id, day_number, status')
      .eq('booking_id', bookingId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) setInfo(data as PackageDayInfo)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId])

  if (!info) return null

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setShowModal(true) }}
        className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 flex-shrink-0 hover:bg-violet-100 transition-all"
        title="Part of a weekly recurring package — click to view all 7 days">
        🔁 Day {info.day_number}/7
      </button>
      {showModal && (
        <RecurringPackageModal
          packageId={info.package_id}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}

// ── Full package detail modal ──────────────────────────────────
type PackageDetail = {
  id: string
  customer_id: string
  worker_id: string | null
  start_date: string
  end_date: string
  standard_time: string
  price_per_visit: number
  total_visits: number
  total_amount: number
  payment_status: string
  status: string
  special_instructions: string | null
}

type DayRow = {
  id: string
  booking_id: string
  day_number: number
  scheduled_at: string
  is_alternate_time: boolean
  status: string
}

function RecurringPackageModal({ packageId, onClose }: {
  packageId: string
  onClose: () => void
}) {
  const supabase = createClient()
  const [pkg, setPkg] = useState<PackageDetail | null>(null)
  const [days, setDays] = useState<DayRow[]>([])
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [workerName, setWorkerName] = useState('')
  const [serviceName, setServiceName] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: p } = await supabase
        .from('recurring_packages')
        .select('*')
        .eq('id', packageId)
        .single()

      if (!p) { setLoading(false); return }
      setPkg(p as PackageDetail)

      const [{ data: d }, { data: customer }, { data: worker }, { data: service }] = await Promise.all([
        supabase.from('recurring_package_days')
          .select('*').eq('package_id', packageId).order('day_number'),
        supabase.from('users').select('full_name, phone').eq('id', p.customer_id).maybeSingle(),
        p.worker_id
          ? supabase.from('users').select('full_name').eq('id', p.worker_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from('services').select('name').eq('id', p.service_id).maybeSingle(),
      ])

      setDays((d ?? []) as DayRow[])
      setCustomerName(customer?.full_name ?? '—')
      setCustomerPhone(customer?.phone ?? '—')
      setWorkerName(worker?.full_name ?? 'Unassigned')
      setServiceName(service?.name ?? '—')
      setLoading(false)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageId])

  function dayStatusPill(status: string) {
    const map: Record<string, { bg: string; color: string; label: string }> = {
      scheduled:           { bg: '#DBEAFE', color: '#2563EB', label: 'Scheduled' },
      completed:           { bg: '#D1FAE5', color: '#059669', label: 'Completed' },
      cancelled_forfeited: { bg: '#FEE2E2', color: '#DC2626', label: 'Cancelled (forfeited)' },
    }
    const cfg = map[status] ?? { bg: '#F1F5F9', color: '#64748B', label: status }
    return (
      <span className="text-[10px] font-bold px-2 py-1 rounded-full"
        style={{ background: cfg.bg, color: cfg.color }}>
        {cfg.label}
      </span>
    )
  }

  const activeDays = days.filter(d => d.status !== 'cancelled_forfeited').length
  const forfeitedDays = days.filter(d => d.status === 'cancelled_forfeited').length

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose}/>
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-black text-slate-800">🔁 Weekly Package</h2>
            <p className="text-xs text-slate-400 mt-0.5">#{packageId.slice(0, 8).toUpperCase()}</p>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-xl flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all">✕</button>
        </div>

        {loading ? (
          <div className="p-10 text-center text-slate-400 text-sm">Loading…</div>
        ) : !pkg ? (
          <div className="p-10 text-center text-red-500 text-sm font-bold">Package not found</div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            <div className="rounded-2xl p-4 bg-violet-50 border border-violet-200">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[10px] text-violet-500 font-bold uppercase">Customer</p>
                  <p className="font-bold text-slate-800">{customerName}</p>
                  <p className="text-xs text-slate-500">{customerPhone}</p>
                </div>
                <div>
                  <p className="text-[10px] text-violet-500 font-bold uppercase">Worker (all 7 days)</p>
                  <p className="font-bold text-slate-800">{workerName}</p>
                </div>
                <div>
                  <p className="text-[10px] text-violet-500 font-bold uppercase">Service</p>
                  <p className="font-bold text-slate-800">{serviceName}</p>
                </div>
                <div>
                  <p className="text-[10px] text-violet-500 font-bold uppercase">Daily Time</p>
                  <p className="font-bold text-slate-800">{pkg.standard_time}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl px-3 py-2.5 bg-slate-50 border border-slate-200 text-center">
                <p className="text-lg font-black text-slate-800">{activeDays}</p>
                <p className="text-[10px] text-slate-400">Active visits</p>
              </div>
              <div className="rounded-xl px-3 py-2.5 bg-slate-50 border border-slate-200 text-center">
                <p className="text-lg font-black text-red-500">{forfeitedDays}</p>
                <p className="text-[10px] text-slate-400">Forfeited</p>
              </div>
              <div className="rounded-xl px-3 py-2.5 bg-cyan-50 border border-cyan-200 text-center">
                <p className="text-lg font-black text-cyan-700">₹{pkg.total_amount}</p>
                <p className="text-[10px] text-cyan-600">
                  {pkg.payment_status === 'paid' ? 'Paid ✓' : pkg.payment_status}
                </p>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
                All 7 Visits
              </p>
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
            </div>

            {pkg.special_instructions && (
              <div className="rounded-xl px-4 py-3 bg-amber-50 border border-amber-200">
                <p className="text-[10px] font-black uppercase tracking-wider text-amber-600 mb-1">
                  Instructions (applies to all visits)
                </p>
                <p className="text-sm text-slate-600">{pkg.special_instructions}</p>
              </div>
            )}

            <p className="text-[11px] text-slate-400 text-center pt-2">
              Individual days can only be reassigned/cancelled from that
              day's own booking row in the main table — this view is
              read-only.
            </p>
          </div>
        )}
      </div>
    </>
  )
}