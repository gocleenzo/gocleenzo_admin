'use client'
// app/(admin)/admin-bookings/bookings_table.tsx
//
// Compact TABLE view of bookings (switchable with the existing cards).
//   - Tabs with live counts: All · Upcoming · Missed assignments ·
//     Assigned not started · Started not completed · History
//   - Customer phone masked (98XXXXX523) with 👁 to reveal
//   - Address hidden behind "Click to view" (opens with Maps + Copy)
//   - ⋮ menu per row with every action the cards have
//
// It only DISPLAYS what the bookings screen already loaded and calls
// back into it for actions — no separate data loading here.
import { useEffect, useMemo, useRef, useState } from 'react'

export type TableBooking = {
  id: string; status: string; scheduled_at: string; created_at: string
  final_amount: number
  service_name: string
  services: { name: string; qty: number }[]
  customer: string; customer_phone: string
  worker: string; worker_id: string | null
  area: string; city: string; full_address: string; flat_no: string; building: string; pincode: string
  latitude: number | null; longitude: number | null
  work_started_at: string | null
  booking_duration_minutes: number | null
  service_duration_minutes: number | null
  service_duration: number
  extra_time_mins: number
  is_manual_booking: boolean
  payment_status: string
}

type TabKey = 'all' | 'upcoming' | 'missed' | 'not_started' | 'not_completed' | 'history'

const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  pending:      { label: 'Pending',      color: '#B45309', bg: '#FEF3C7' },
  accepted:     { label: 'Assigned',     color: '#6D28D9', bg: '#EDE9FE' },
  otp_verified: { label: 'OTP Verified', color: '#6D28D9', bg: '#EDE9FE' },
  in_progress:  { label: 'In Progress',  color: '#0E7490', bg: '#CFFAFE' },
  completed:    { label: 'Completed',    color: '#047857', bg: '#D1FAE5' },
  cancelled:    { label: 'Cancelled',    color: '#BE123C', bg: '#FFE4E6' },
}

const ACTIVE = ['pending', 'accepted', 'otp_verified', 'in_progress']

function plannedMins(b: TableBooking) {
  return (b.service_duration_minutes ?? b.booking_duration_minutes ?? b.service_duration ?? 60) + (b.extra_time_mins ?? 0)
}

/** Which problem tabs a booking belongs to, right now. */
function classify(b: TableBooking, now: number) {
  const start = new Date(b.scheduled_at).getTime()
  return {
    upcoming: ACTIVE.includes(b.status),
    history: b.status === 'completed' || b.status === 'cancelled',
    // Nobody assigned, and it starts within 2 hours (or is already late)
    missed: !b.worker_id && b.status === 'pending' && start - now < 2 * 60 * 60 * 1000,
    // Professional assigned, start time has passed, work not started
    not_started: !!b.worker_id && ['pending', 'accepted', 'otp_verified'].includes(b.status) && start < now,
    // Work running longer than booked
    not_completed: b.status === 'in_progress' && !!b.work_started_at
      && new Date(b.work_started_at).getTime() + plannedMins(b) * 60000 < now,
  }
}

function maskPhone(phone: string) {
  const d = (phone || '').replace(/\D/g, '')
  const ten = d.length >= 10 ? d.slice(-10) : d
  if (ten.length < 6) return phone || '—'
  return `${ten.slice(0, 2)}XXXXX${ten.slice(-3)}`
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
}
function fmtWeekday(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' })
}
function fmtCreated(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
}
function fmtDur(mins: number) {
  const h = Math.floor(mins / 60), m = mins % 60
  return h && m ? `${h}H ${m}M` : h ? `${h} HOUR${h > 1 ? 'S' : ''}` : `${m} MINUTE`
}
function timeUntil(iso: string, now: number) {
  const diff = new Date(iso).getTime() - now
  const mins = Math.round(Math.abs(diff) / 60000)
  const txt = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`
  return diff >= 0 ? `in ${txt}` : `${txt} late`
}
function fullAddress(b: TableBooking) {
  return [b.flat_no, b.building, b.full_address || b.area, b.city, b.pincode].filter(Boolean).join(', ')
}
function mapsUrl(b: TableBooking) {
  return b.latitude != null && b.longitude != null
    ? `https://maps.google.com/?q=${b.latitude},${b.longitude}`
    : `https://maps.google.com/?q=${encodeURIComponent(fullAddress(b))}`
}

function CopyBtn({ text, title }: { text: string; title: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={e => {
        e.stopPropagation()
        try { navigator.clipboard.writeText(text) } catch {}
        setDone(true); setTimeout(() => setDone(false), 1200)
      }}
      title={title}
      className="text-[11px] text-slate-400 hover:text-slate-700 px-1">
      {done ? '✓' : '⧉'}
    </button>
  )
}

type MenuAction = { label: string; onClick: () => void; danger?: boolean }

function RowMenu({ actions }: { actions: MenuAction[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div ref={ref} className="relative inline-block">
      <button onClick={() => setOpen(o => !o)}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 text-lg font-black">
        ⋮
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-30 w-48 bg-white rounded-xl border border-slate-200 shadow-xl py-1">
          {actions.map(a => (
            <button key={a.label}
              onClick={() => { setOpen(false); a.onClick() }}
              className="w-full text-left px-3.5 py-2 text-[12.5px] font-bold hover:bg-slate-50"
              style={{ color: a.danger ? '#DC2626' : '#334155' }}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function BookingsTable({
  bookings, isOwner, canUnassign,
  onDetails, onUnassign, onComplete, onCancel, onNearby,
}: {
  bookings: TableBooking[]
  isOwner: boolean
  canUnassign: (bookingId: string) => boolean
  onDetails: (b: TableBooking) => void
  onUnassign: (bookingId: string) => void
  onComplete: (bookingId: string) => void
  onCancel: (bookingId: string) => void
  onNearby: (b: TableBooking) => void
}) {
  const [tab, setTab] = useState<TabKey>('all')
  const [shownPhones, setShownPhones] = useState<Set<string>>(new Set())
  const [shownAddresses, setShownAddresses] = useState<Set<string>>(new Set())
  const [now, setNow] = useState(() => Date.now())

  // Re-check the problem tabs every minute (a booking can become "missed" or "late" while you watch)
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(i)
  }, [])

  const classified = useMemo(
    () => bookings.map(b => ({ b, c: classify(b, now) })),
    [bookings, now])

  const counts = useMemo(() => ({
    all: classified.length,
    upcoming: classified.filter(x => x.c.upcoming).length,
    missed: classified.filter(x => x.c.missed).length,
    not_started: classified.filter(x => x.c.not_started).length,
    not_completed: classified.filter(x => x.c.not_completed).length,
    history: classified.filter(x => x.c.history).length,
  }), [classified])

  const rows = useMemo(() => {
    const list = tab === 'all' ? classified : classified.filter(x => (x.c as any)[tab])
    // Sorted by scheduled time — history newest first, everything else soonest first
    return [...list].sort((a, z) => {
      const d = new Date(a.b.scheduled_at).getTime() - new Date(z.b.scheduled_at).getTime()
      return tab === 'history' ? -d : d
    })
  }, [classified, tab])

  const TABS: { key: TabKey; label: string; alert?: boolean }[] = [
    { key: 'all', label: 'All' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'missed', label: 'Missed Assignments', alert: true },
    { key: 'not_started', label: 'Assigned, Not Started', alert: true },
    { key: 'not_completed', label: 'Started, Not Completed', alert: true },
    { key: 'history', label: 'History' },
  ]

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const n = new Set(set)
    n.has(id) ? n.delete(id) : n.add(id)
    setter(n)
  }

  return (
    <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1px solid #E7EBF3' }}>
      {/* Tabs */}
      <div className="flex gap-5 overflow-x-auto px-4" style={{ borderBottom: '1px solid #EEF1F6' }}>
        {TABS.map(t => {
          const active = tab === t.key
          const n = counts[t.key]
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="py-3 text-[12.5px] font-bold whitespace-nowrap flex items-center gap-1.5 transition-all"
              style={{ color: active ? '#0E7490' : '#6B7280', borderBottom: `2px solid ${active ? '#0891B2' : 'transparent'}` }}>
              {t.label}
              <span className="min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-black inline-flex items-center justify-center"
                style={t.alert && n > 0
                  ? { background: '#DC2626', color: '#fff' }
                  : { background: '#F1F5F9', color: '#64748B' }}>
                {n}
              </span>
            </button>
          )
        })}
      </div>

      {rows.length === 0 ? (
        <div className="p-14 text-center">
          <p className="text-4xl mb-2">{tab === 'all' || tab === 'upcoming' || tab === 'history' ? '☕' : '✅'}</p>
          <p className="font-black text-slate-700">
            {tab === 'missed' ? 'No missed assignments'
              : tab === 'not_started' ? 'No late starts'
              : tab === 'not_completed' ? 'No jobs running over time'
              : 'Nothing here'}
          </p>
          <p className="text-[12px] text-slate-400 mt-1">Uses the date, area and professional filters above.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr className="bg-slate-50/70" style={{ borderBottom: '1px solid #EEF1F6' }}>
                {['Order', 'Scheduled', 'Customer', 'Address', 'Services', 'Professional', 'Area', 'Status', 'Price', ''].map(h => (
                  <th key={h} className="text-left px-3 py-2.5 text-[10.5px] font-black text-slate-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ b, c }) => {
                const st = STATUS_STYLE[b.status] ?? STATUS_STYLE.pending
                const phoneShown = shownPhones.has(b.id)
                const addrShown = shownAddresses.has(b.id)
                const flagged = c.missed || c.not_started || c.not_completed
                const actions: MenuAction[] = [{ label: '📋 Details', onClick: () => onDetails(b) }]
                if (!b.worker_id && ['pending', 'accepted'].includes(b.status)) {
                  actions.push({ label: '👤 Assign professional', onClick: () => onDetails(b) })
                }
                if (b.worker_id && ['pending', 'accepted'].includes(b.status)) {
                  actions.push({ label: '🔁 Reassign', onClick: () => onDetails(b) })
                }
                if (b.worker_id && ACTIVE.includes(b.status)) {
                  actions.push({ label: '🧭 Nearby jobs', onClick: () => onNearby(b) })
                }
                if (b.is_manual_booking && b.status === 'accepted' && b.worker_id) {
                  actions.push({ label: '▶️ Start work', onClick: () => onDetails(b) })
                }
                if (b.status === 'in_progress') {
                  actions.push({ label: '✓ Mark done', onClick: () => onComplete(b.id) })
                }
                if (b.worker_id && ['pending', 'accepted'].includes(b.status) && canUnassign(b.id)) {
                  actions.push({ label: '🚫 Unassign', onClick: () => onUnassign(b.id), danger: true })
                }
                if (ACTIVE.includes(b.status)) {
                  actions.push({ label: '✕ Cancel booking', onClick: () => onCancel(b.id), danger: true })
                }

                return (
                  <tr key={b.id} className="align-top hover:bg-slate-50/60"
                    style={{ borderBottom: '1px solid #F1F5F9', background: flagged ? '#FFFBFB' : undefined }}>
                    {/* Order */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <button onClick={() => onDetails(b)} className="font-black text-cyan-700 hover:underline font-mono">
                        #{b.id.slice(0, 8).toUpperCase()}
                      </button>
                      <CopyBtn text={b.id} title="Copy booking ID" />
                      <div className="mt-1">
                        <span className="text-[10px] font-black px-1.5 py-0.5 rounded"
                          style={b.is_manual_booking ? { background: '#F4F4F5', color: '#52525B' } : { background: '#ECFEFF', color: '#0E7490' }}>
                          {b.is_manual_booking ? '📞 Phone' : '📱 App'}
                        </span>
                      </div>
                    </td>

                    {/* Scheduled */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <p className="font-bold text-slate-800">{fmtDate(b.scheduled_at)}</p>
                      <p className="font-black text-slate-800">{fmtTime(b.scheduled_at)}</p>
                      <p className="text-slate-500">{fmtWeekday(b.scheduled_at)}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Created {fmtCreated(b.created_at)}</p>
                    </td>

                    {/* Customer */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <p className="font-bold text-slate-800">{b.customer}</p>
                      <div className="flex items-center gap-1">
                        {phoneShown
                          ? <a href={`tel:${b.customer_phone}`} className="font-bold text-cyan-700 hover:underline">{b.customer_phone}</a>
                          : <span className="font-mono text-slate-600">{maskPhone(b.customer_phone)}</span>}
                        <button onClick={() => toggle(shownPhones, b.id, setShownPhones)}
                          title={phoneShown ? 'Hide number' : 'Show number'}
                          className="text-[12px] px-1 text-slate-400 hover:text-slate-700">
                          {phoneShown ? '🙈' : '👁'}
                        </button>
                        {phoneShown && <CopyBtn text={b.customer_phone} title="Copy number" />}
                      </div>
                    </td>

                    {/* Address */}
                    <td className="px-3 py-3 min-w-[170px] max-w-[240px]">
                      {addrShown ? (
                        <div>
                          <p className="text-slate-700 leading-snug">{fullAddress(b) || '—'}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <a href={mapsUrl(b)} target="_blank" rel="noopener noreferrer"
                              className="text-[11px] font-bold text-cyan-700 hover:underline">📍 Maps</a>
                            <CopyBtn text={fullAddress(b)} title="Copy address" />
                            <button onClick={() => toggle(shownAddresses, b.id, setShownAddresses)}
                              className="text-[11px] font-bold text-slate-400 hover:text-slate-600">Hide</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => toggle(shownAddresses, b.id, setShownAddresses)}
                          className="text-[12px] font-bold text-cyan-700 underline underline-offset-2 hover:text-cyan-900">
                          Click to view
                        </button>
                      )}
                    </td>

                    {/* Services */}
                    <td className="px-3 py-3 min-w-[170px]">
                      {b.services.map((s, i) => (
                        <p key={`${s.name}-${i}`} className="text-slate-700 font-semibold leading-snug">
                          {s.name}{s.qty > 1 ? ` ×${s.qty}` : ''}
                        </p>
                      ))}
                      <span className="inline-block mt-1 text-[9.5px] font-black px-2 py-0.5 rounded-full text-white" style={{ background: '#475569' }}>
                        {fmtDur(plannedMins(b))}
                      </span>
                    </td>

                    {/* Professional */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      {b.worker_id ? (
                        <p className="font-bold text-slate-700">{b.worker.split(' ')[0]}</p>
                      ) : (
                        <>
                          <p className="text-slate-400">N/A</p>
                          {ACTIVE.includes(b.status) && (
                            <p className="text-[10.5px] font-black" style={{ color: c.missed ? '#DC2626' : '#B45309' }}>
                              {timeUntil(b.scheduled_at, now)}
                            </p>
                          )}
                        </>
                      )}
                    </td>

                    {/* Area */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <p className="text-slate-700">{b.area || '—'}</p>
                      <p className="text-[10.5px] text-slate-400">{b.pincode}</p>
                    </td>

                    {/* Status */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="text-[11px] font-black px-2 py-1 rounded-full" style={{ background: st.bg, color: st.color }}>
                        {st.label}
                      </span>
                      {c.missed && <p className="text-[10px] font-black text-red-600 mt-1">⚠️ Needs a professional</p>}
                      {c.not_started && <p className="text-[10px] font-black text-red-600 mt-1">⚠️ Should have started</p>}
                      {c.not_completed && <p className="text-[10px] font-black text-red-600 mt-1">⚠️ Running over time</p>}
                    </td>

                    {/* Price */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <p className={`font-black ${b.status === 'cancelled' ? 'line-through text-slate-300' : 'text-slate-800'}`}>
                        ₹{b.final_amount.toLocaleString('en-IN')}
                      </p>
                      {isOwner && (
                        <p className="text-[10px] text-slate-400">{b.payment_status === 'paid' ? 'Paid' : 'Cash due'}</p>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-2 py-2.5 text-right">
                      <RowMenu actions={actions} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="px-4 py-2.5 text-[11px] text-slate-400 text-right" style={{ borderTop: '1px solid #F1F5F9' }}>
        {rows.length} booking{rows.length === 1 ? '' : 's'}
      </div>
    </div>
  )
}