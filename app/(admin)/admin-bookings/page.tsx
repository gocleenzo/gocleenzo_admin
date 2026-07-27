'use client'
import { useEffect, useState, useCallback, Fragment } from 'react'
import { createClient } from '@/lib/supabase/client'
import AssignMap from './assign_map'

type BookedService = { name: string; qty: number; unit_price: number }

type Booking = {
  id: string; status: string; final_amount: number; base_price: number
  discount_amount: number; scheduled_at: string; created_at: string
  service_name: string; service_duration: number
  services: BookedService[]
  customer: string; customer_id: string; customer_phone: string
  worker: string; worker_id: string | null; worker_phone: string
  area: string; city: string; otp: string; payment_status: string
  special_instructions: string | null
  work_started_at: string | null; work_ended_at: string | null
  booking_duration_minutes: number | null
  service_duration_minutes: number | null
  extra_time_mins: number; extra_time_price: number
  extra_time_payment_status: string | null
}
type Worker = {
  id: string; name: string; phone: string
  is_available: boolean; is_busy: boolean
  // Date-specific schedule (replaces the old day-of-week `schedule` JSONB).
  // Keyed by 'yyyy-MM-dd' -> that date's hours, from worker_schedule_dates.
  scheduleDates: Record<string, { enabled: boolean; start: string; end: string; breaks: { from: string; to: string }[] }> | null
  // True if this worker has EVER set any date-specific schedule at all.
  // Used to decide the fallback for dates with no explicit entry — see
  // isWorkerAvailableAt.
  hasAnyScheduleDates: boolean
}

const STATUS: Record<string, { label: string; color: string; bg: string; icon: string; step: number }> = {
  pending:      { label: 'Pending',      color: '#D97706', bg: '#FEF3C7', icon: '⏳', step: 0 },
  accepted:     { label: 'Assigned',     color: '#2563EB', bg: '#DBEAFE', icon: '👤', step: 1 },
  otp_verified: { label: 'OTP Verified', color: '#7C3AED', bg: '#EDE9FE', icon: '🔓', step: 2 },
  in_progress:  { label: 'In Progress',  color: '#0891B2', bg: '#CFFAFE', icon: '⚡', step: 3 },
  completed:    { label: 'Completed',    color: '#059669', bg: '#D1FAE5', icon: '✓',  step: 4 },
  cancelled:    { label: 'Cancelled',    color: '#DC2626', bg: '#FEE2E2', icon: '✕',  step: -1 },
}
const STEPS = ['pending','accepted','otp_verified','in_progress','completed']

async function sendNotification(
  userId: string, title: string, body: string, data?: Record<string, string>
) {
  try {
    const res = await fetch('/api/notification/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, title, body, data }),
    })
    const json = await res.json()
    if (!json.success) console.warn('Notification not sent:', json.reason ?? json.error)
  } catch (err) {
    console.error('Notification error:', err)
  }
}

function dur(sec: number) {
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60
  if (h) return `${h}h ${m}m ${s}s`; if (m) return `${m}m ${s}s`; return `${s}s`
}
function durShort(sec: number) {
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60
  if (h) return `${h}h ${m}m`; if (m) return `${m}m ${s}s`; return `${s}s`
}
function elapsed(start: string | null, end?: string | null) {
  if (!start) return 0
  return Math.floor(((end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()) / 1000)
}
function timeToMins(t: string) {
  const [h, m] = t.split(':').map(Number); return h * 60 + m
}

/// Local (Asia/Kolkata) date string 'yyyy-MM-dd' for a given Date.
function localDateStr(d: Date): string {
  const local = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
}

function isWorkerAvailableAt(
  worker: Worker, scheduledAt: string, durationMins: number,
  existingBookings: { worker_id: string; scheduled_at: string }[]
): boolean {
  if (!worker.is_available) return false
  const slotDt    = new Date(scheduledAt)
  const slotEnd   = new Date(slotDt.getTime() + durationMins * 60000)
  const localSlot = new Date(slotDt.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))

  // Date-specific schedule check (replaces the old day-of-week model —
  // matches what the worker app now proposes/admin approves per date).
  const dateStr = localDateStr(slotDt)
  const dayEntry = worker.scheduleDates?.[dateStr]
  if (dayEntry) {
    if (!dayEntry.enabled) return false
    const slotMins = localSlot.getHours() * 60 + localSlot.getMinutes()
    if (slotMins < timeToMins(dayEntry.start) || slotMins >= timeToMins(dayEntry.end)) return false
    for (const b of (dayEntry.breaks ?? [])) {
      if (slotMins >= timeToMins(b.from) && slotMins < timeToMins(b.to)) return false
    }
  } else if (worker.hasAnyScheduleDates) {
    // This worker uses date-specific scheduling but has no entry for this
    // exact date — treat as unavailable. Once a worker has started setting
    // explicit dates, silence for a given date means "not scheduled", not
    // "assume free" — that's the whole point of the date-specific model.
    return false
  }
  // else: worker has never set ANY date-specific schedule — fall back to
  // "always available" so newly-onboarded workers aren't silently blocked
  // from assignment before anyone has asked them to set a schedule.

  for (const bk of existingBookings) {
    if (bk.worker_id !== worker.id) continue
    const bkDt  = new Date(bk.scheduled_at)
    const bkEnd = new Date(bkDt.getTime() + durationMins * 60000)
    if (slotDt < bkEnd && slotEnd > bkDt) return false
  }
  return true
}

function getOtpWindowStatus(scheduledAt: string, durationMins: number): {
  status: 'too_early' | 'open' | 'expired'; message: string
} {
  const scheduled   = new Date(scheduledAt)
  const now         = new Date()
  const windowStart = new Date(scheduled.getTime() - 30 * 60000)
  const windowEnd   = new Date(scheduled.getTime() + durationMins * 60000)
  if (now < windowStart) {
    const minsUntil = Math.ceil((windowStart.getTime() - now.getTime()) / 60000)
    const h = Math.floor(minsUntil / 60), m = minsUntil % 60
    const timeStr = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`
    return { status: 'too_early', message: `Customer can enter OTP in ${timeStr}` }
  }
  if (now > windowEnd) return { status: 'expired', message: 'OTP window has expired' }
  return { status: 'open', message: 'Customer can enter OTP now' }
}

function LiveTimer({ start, end, color = '#0891B2', large = false }: {
  start: string | null; end?: string | null; color?: string; large?: boolean
}) {
  const [t, setT] = useState(elapsed(start, end))
  useEffect(() => {
    if (!start || end) { setT(elapsed(start, end)); return }
    setT(elapsed(start))
    const i = setInterval(() => setT(elapsed(start)), 1000)
    return () => clearInterval(i)
  }, [start, end])
  if (!start) return null
  const isLive = !!start && !end
  return (
    <span className={`flex items-center gap-1.5 font-mono font-black ${large ? 'text-2xl' : 'text-sm'}`} style={{ color }}>
      {isLive && <span className={`rounded-full animate-pulse flex-shrink-0 ${large ? 'w-2.5 h-2.5' : 'w-1.5 h-1.5'}`} style={{ background: color }}/>}
      {large ? dur(t) : durShort(t)}
      {!isLive && <span className={`font-normal opacity-50 ml-1 ${large ? 'text-sm' : 'text-[10px]'}`}>total</span>}
    </span>
  )
}

function StepBar({ status }: { status: string }) {
  const curr = STATUS[status]?.step ?? 0
  if (status === 'cancelled') return (
    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-600">✕ Cancelled</span>
  )
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {STEPS.map((s, i) => {
        const cfg = STATUS[s]; const done = curr > cfg.step; const active = s === status
        return (
          <div key={s} className="flex items-center gap-1 flex-shrink-0">
            <div className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1 whitespace-nowrap"
              style={{
                background: active ? cfg.bg : done ? `${cfg.color}15` : '#F8FAFC',
                color:      active ? cfg.color : done ? cfg.color : '#94A3B8',
                border:     `1px solid ${active ? cfg.color+'40' : done ? cfg.color+'25' : '#E2E8F0'}`,
              }}>
              {active && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: cfg.color }}/>}
              {done && '✓ '}{cfg.label}
            </div>
            {i < STEPS.length-1 && <div className="w-3 h-px flex-shrink-0" style={{ background: done ? '#CBD5E1' : '#E2E8F0' }}/>}
          </div>
        )
      })}
    </div>
  )
}

function WorkerOtpChip({ workerId }: { workerId: string | null }) {
  const [otp, setOtp] = useState<string|null>(null)
  const supabase = createClient()
  useEffect(() => {
    if (!workerId) return
    supabase.from('workers').select('worker_otp').eq('user_id', workerId).maybeSingle()
      .then(({ data }) => setOtp(data?.worker_otp ?? null))
  }, [workerId])
  if (!otp) return null
  return (
    <span className="px-2 py-1 rounded-lg text-[11px] font-bold bg-violet-50 border border-violet-200 text-violet-600 font-mono inline-flex items-center gap-1">
      🔐 {otp}
    </span>
  )
}

function OtpStatusBox({ b }: { b: Booking }) {
  const [workerOtp,  setWorkerOtp]  = useState<string|null>(null)
  const [otpLoading, setOtpLoading] = useState(true)
  const [,           setTick]       = useState(0)
  const supabase = createClient()
  useEffect(() => {
    if (!b.worker_id) { setOtpLoading(false); return }
    supabase.from('workers').select('worker_otp').eq('user_id', b.worker_id).maybeSingle()
      .then(({ data }) => { setWorkerOtp(data?.worker_otp ?? null); setOtpLoading(false) })
  }, [b.worker_id])
  useEffect(() => {
    const i = setInterval(() => setTick(t => t + 1), 60000)
    return () => clearInterval(i)
  }, [])
  const durationMins = b.service_duration || 60
  const window = getOtpWindowStatus(b.scheduled_at, durationMins)
  const windowColors = {
    too_early: { bg: '#F0F9FF', border: '#BAE6FD', text: '#0369A1', icon: '🕐' },
    open:      { bg: '#ECFDF5', border: '#6EE7B7', text: '#065F46', icon: '✅' },
    expired:   { bg: '#FEF2F2', border: '#FECACA', text: '#DC2626', icon: '⌛' },
  }
  const wc = windowColors[window.status]
  return (
    <div className="rounded-2xl p-4 space-y-3 bg-violet-50 border border-violet-200">
      <div className="flex items-center gap-2">
        <span className="text-lg">🔐</span>
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-violet-700">OTP Verification</p>
          <p className="text-xs text-slate-500">Customer enters this in their app to start the job</p>
        </div>
      </div>
      <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-white border border-violet-200">
        <div>
          <p className="text-[10px] text-slate-400 mb-0.5">Worker's Permanent OTP</p>
          {otpLoading
            ? <p className="text-sm text-slate-400">Loading…</p>
            : workerOtp
              ? <p className="font-mono font-black text-2xl text-violet-700 tracking-widest">{workerOtp}</p>
              : <p className="text-sm font-bold text-red-500">⚠️ Not set — Workers → Edit</p>
          }
        </div>
        <div className="text-right">
          <p className="text-[10px] text-slate-400">Worker tells this</p>
          <p className="text-[10px] text-slate-400">to the customer</p>
        </div>
      </div>
      <div className="px-3 py-2.5 rounded-xl flex items-center gap-2"
        style={{ background: wc.bg, border: `1px solid ${wc.border}` }}>
        <span>{wc.icon}</span>
        <p className="text-xs font-bold" style={{ color: wc.text }}>{window.message}</p>
        {window.status === 'open' && (
          <span className="w-2 h-2 rounded-full animate-pulse ml-auto flex-shrink-0" style={{ background: wc.text }}/>
        )}
      </div>
      <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
        <p className="text-[10px] text-slate-400">Scheduled slot</p>
        <p className="text-xs font-black text-slate-700">
          {new Date(b.scheduled_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          {' · '}Window opens 30 min before
        </p>
      </div>
    </div>
  )
}

function WorkerOtpDisplay({ workerId }: { workerId: string | null }) {
  const [workerOtp, setWorkerOtp] = useState<string|null>(null)
  const [loading,   setLoading]   = useState(true)
  const supabase = createClient()
  useEffect(() => {
    async function fetch() {
      if (!workerId) { setLoading(false); return }
      const { data } = await supabase.from('workers').select('worker_otp').eq('user_id', workerId).maybeSingle()
      setWorkerOtp(data?.worker_otp ?? null); setLoading(false)
    }
    fetch()
  }, [workerId])
  return (
    <div className="rounded-2xl p-4 text-center bg-violet-50 border border-violet-200">
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Worker OTP</p>
      {loading
        ? <p className="text-slate-400 text-sm">…</p>
        : workerOtp
          ? <><p className="text-3xl font-black font-mono tracking-widest text-violet-600">{workerOtp}</p>
              <p className="text-[10px] text-slate-400 mt-1">Worker tells this to customer</p></>
          : <p className="text-xs font-bold text-red-500 mt-1">⚠️ Not set<br/><span className="font-normal text-slate-400">Go to Workers → Edit</span></p>
      }
    </div>
  )
}

// ── Drawer (unchanged) ─────────────────────────────────────────
function Drawer({
  b, workers, allBookings, onClose, onDone
}: {
  b: Booking; workers: Worker[]
  allBookings: { worker_id: string; scheduled_at: string }[]
  onClose: () => void; onDone: () => void
}) {
  const [selW, setSelW] = useState(b.worker_id ?? '')
  const [busy, setBusy] = useState(false)
  const supabase = createClient()
  const cfg = STATUS[b.status] ?? STATUS.pending
  const durationMins = b.service_duration || 60
  const availableForSlot = workers.filter(w =>
    w.id === b.worker_id ||
    isWorkerAvailableAt(w, b.scheduled_at, durationMins, allBookings)
  )
  const canAssign  = ['pending','accepted'].includes(b.status)
  const totalSec   = b.work_started_at && b.work_ended_at
    ? elapsed(b.work_started_at, b.work_ended_at) : 0

  const scheduledStr = new Date(b.scheduled_at).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  })

  async function assign() {
    if (!selW) return; setBusy(true)
    await supabase.from('bookings')
      .update({ worker_id: selW, status: 'accepted' })
      .eq('id', b.id)
    await sendNotification(
      b.customer_id, '✅ Booking Confirmed!',
      `Your ${b.service_name} is scheduled for ${scheduledStr}. A verified pro has been assigned.`,
      { booking_id: b.id, type: 'booking_assigned' }
    )
    setBusy(false); onDone()
  }

  async function act(status: string) {
    setBusy(true)
    const now = new Date().toISOString()
    const u: any = { status }
    if (status === 'completed') {
      u.work_ended_at = now
      u.payment_status = 'paid'
      if (b.work_started_at) {
        u.work_duration_seconds = Math.floor(
          (new Date(now).getTime() - new Date(b.work_started_at).getTime()) / 1000)
      }
    }
    if (status === 'cancelled') u.work_ended_at = now
    await supabase.from('bookings').update(u).eq('id', b.id)
    if (status === 'completed') {
      await sendNotification(
        b.customer_id, '🎉 Cleaning Complete!',
        `Your ${b.service_name} is done. Hope you love it! Please rate your experience.`,
        { booking_id: b.id, type: 'booking_completed' }
      )
    }
    if (status === 'cancelled') {
      await sendNotification(
        b.customer_id, '❌ Booking Cancelled',
        `Your ${b.service_name} booking has been cancelled. Contact us for support.`,
        { booking_id: b.id, type: 'booking_cancelled' }
      )
    }
    setBusy(false); onDone()
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose}/>
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg flex flex-col bg-white"
        style={{ borderLeft: '1px solid #E2E8F0', boxShadow: '-20px 0 60px rgba(0,0,0,0.1)' }}>

        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-black text-slate-800">Booking Details</h2>
            <p className="text-xs font-mono text-slate-400 mt-0.5">#{b.id.slice(0,8).toUpperCase()}</p>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-xl flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="rounded-2xl p-4 border" style={{ background: cfg.bg, borderColor: cfg.color+'30' }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: cfg.color }}>Status</p>
                <p className="font-black text-xl text-slate-800">{cfg.icon} {cfg.label}</p>
              </div>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${b.payment_status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                {b.payment_status === 'paid' ? '✓ Paid' : '⏳ Pending'}
              </span>
            </div>
            <StepBar status={b.status}/>
          </div>

          {b.work_started_at && (
            <div className="rounded-2xl p-5 border"
              style={{ background: b.work_ended_at ? '#ECFDF5' : '#ECFEFF', borderColor: b.work_ended_at ? '#6EE7B7' : '#67E8F9' }}>
              <p className="text-[10px] font-black uppercase tracking-wider mb-3"
                style={{ color: b.work_ended_at ? '#059669' : '#0891B2' }}>
                {b.work_ended_at ? '✓ Work Completed' : '⚡ Work In Progress'}
              </p>
              <div className="flex items-end justify-between">
                <LiveTimer start={b.work_started_at} end={b.work_ended_at}
                  color={b.work_ended_at ? '#059669' : '#0891B2'} large/>
                <div className="text-right space-y-2">
                  <div>
                    <p className="text-[10px] text-slate-400">Started</p>
                    <p className="text-sm font-black text-slate-800">
                      {new Date(b.work_started_at).toLocaleTimeString('en-IN',
                        { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </p>
                  </div>
                  {b.work_ended_at && (
                    <div>
                      <p className="text-[10px] text-slate-400">Ended</p>
                      <p className="text-sm font-black text-slate-800">
                        {new Date(b.work_ended_at).toLocaleTimeString('en-IN',
                          { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </p>
                    </div>
                  )}
                </div>
              </div>
              {b.work_ended_at && totalSec > 0 && (
                <div className="mt-4 pt-3 flex items-center justify-between border-t border-green-200">
                  <p className="text-xs text-slate-500">Total Work Duration</p>
                  <span className="font-mono font-black text-sm text-green-700 bg-green-100 px-3 py-1.5 rounded-xl">
                    ⏱ {dur(totalSec)}
                  </span>
                </div>
              )}
            </div>
          )}

          {b.status === 'accepted' && b.worker_id && <OtpStatusBox b={b}/>}

          {b.status === 'in_progress' && (
            <button onClick={() => act('completed')} disabled={busy}
              className="w-full flex items-center gap-3 px-4 py-4 rounded-2xl bg-green-50 border border-green-200 hover:bg-green-100 transition-all active:scale-[0.98] disabled:opacity-50">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-lg bg-green-100 text-green-600 flex-shrink-0">
                {busy ? '…' : '✓'}
              </div>
              <div className="flex-1 text-left">
                <p className="font-black text-sm text-green-700">Mark Complete</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Timer stops · Payment marked paid · Customer notified 🔔</p>
              </div>
              <span className="text-green-400 text-lg">›</span>
            </button>
          )}

          {['pending','accepted'].includes(b.status) && (
            <button onClick={() => act('cancelled')} disabled={busy}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-red-50 border border-red-200 hover:bg-red-100 transition-all active:scale-[0.98] disabled:opacity-50">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-red-100 text-red-500 flex-shrink-0">✕</div>
              <div className="flex-1 text-left">
                <p className="font-black text-sm text-red-600">Cancel Booking</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Customer will be notified 🔔</p>
              </div>
            </button>
          )}

          {canAssign && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  {b.worker_id ? 'Reassign Worker' : 'Assign Worker'}
                </p>
                <p className="text-[10px] text-slate-400">
                  {availableForSlot.filter(w => w.id !== b.worker_id).length} available at this time
                </p>
              </div>
              <div className="rounded-2xl p-4 space-y-3 bg-slate-50 border border-slate-200">
                {/* Customer location + nearest LIVE workers */}
                <AssignMap
                  bookingId={b.id}
                  selectedWorkerId={selW}
                  onSelectWorker={(id) => setSelW(id)}
                />
                {b.worker_id && (
                  <div className="flex items-center gap-3 pb-3 border-b border-slate-200">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-white bg-amber-500 flex-shrink-0">
                      {b.worker[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div>
                      <p className="text-slate-800 text-sm font-bold">{b.worker}</p>
                      <p className="text-xs text-slate-400">Currently assigned</p>
                    </div>
                  </div>
                )}
                {availableForSlot.filter(w => w.id !== b.worker_id).length === 0 && !b.worker_id ? (
                  <div className="rounded-xl px-4 py-3 text-center bg-red-50 border border-red-200">
                    <p className="text-sm font-bold text-red-600">No workers available at this time slot</p>
                    <p className="text-xs text-red-400 mt-1">All workers are busy or off-shift at {new Date(b.scheduled_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                ) : (
                  <>
                    <select value={selW} onChange={e => setSelW(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-white border border-slate-200">
                      <option value="">Select worker…</option>
                      {availableForSlot.map(w => (
                        <option key={w.id} value={w.id}>
                          {w.name} — {w.phone}
                          {w.id === b.worker_id ? ' (current)' : ''}
                          {!isWorkerAvailableAt(w, b.scheduled_at, durationMins, allBookings) && w.id !== b.worker_id ? ' ⚠️ busy' : ''}
                        </option>
                      ))}
                    </select>
                    <button onClick={assign} disabled={!selW || busy || selW === b.worker_id}
                      className="w-full h-11 rounded-xl font-black text-sm text-white disabled:opacity-40 active:scale-[0.98] transition-all"
                      style={{ background: 'linear-gradient(135deg,#0891B2,#4F46E5)' }}>
                      {busy ? '…' : b.worker_id ? '✓ Reassign + Notify Customer 🔔' : '+ Assign Worker + Notify Customer 🔔'}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <WorkerOtpDisplay workerId={b.worker_id}/>
            <div className="rounded-2xl p-4 text-center bg-slate-50 border border-slate-200">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Scheduled</p>
              <p className="text-xl font-black text-slate-800">
                {new Date(b.scheduled_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </p>
              <p className="text-sm font-bold text-slate-500 mt-0.5">
                {new Date(b.scheduled_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </p>
              {b.service_duration_minutes != null ? (
                <p className="text-[10px] mt-1">
                  <span className="text-violet-600 font-bold">
                    {b.service_duration_minutes + b.extra_time_mins} min
                  </span>{' '}
                  <span className="text-slate-400">actual</span>
                  {b.booking_duration_minutes && b.booking_duration_minutes !== b.service_duration_minutes && (
                    <>
                      {' · '}
                      <span className="text-cyan-600 font-bold">{b.booking_duration_minutes} min</span>{' '}
                      <span className="text-slate-400">slot reserved</span>
                    </>
                  )}
                </p>
              ) : b.booking_duration_minutes ? (
                <p className="text-[10px] mt-1"><span className="text-cyan-600 font-bold">{b.booking_duration_minutes} min</span> <span className="text-slate-400">booked</span></p>
              ) : (
                <p className="text-[10px] text-slate-400 mt-1">{durationMins} min service</p>
              )}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
              Pricing {b.services.length > 1 ? `· ${b.services.length} services` : ''}
            </p>
            <div className="rounded-2xl overflow-hidden border border-slate-200">
              {[
                ...(b.services.length > 1
                  ? b.services.map(s => ({
                      label: s.qty > 1 ? `${s.name} ×${s.qty}` : s.name,
                      value: `₹${(s.unit_price * s.qty).toLocaleString('en-IN')}`,
                      cls: 'text-slate-700',
                    }))
                  : [{ label: 'Service', value: b.service_name, cls: 'text-slate-700' }]),
                { label: 'Base Price', value: `₹${b.base_price.toLocaleString('en-IN')}`, cls: 'text-slate-700' },
                { label: 'Discount',   value: b.discount_amount > 0 ? `-₹${b.discount_amount.toLocaleString('en-IN')}` : '—', cls: b.discount_amount > 0 ? 'text-green-600' : 'text-slate-400' },
                { label: 'Cash Due (Worker)', value: `₹${b.final_amount.toLocaleString('en-IN')}`, cls: 'text-cyan-700 font-black', bg: 'bg-cyan-50' },
              ].map((r, i, arr) => (
                <div key={`${r.label}-${i}`} className={`flex items-center justify-between px-4 py-3 ${(r as any).bg ?? ''} ${i < arr.length - 1 ? 'border-b border-slate-100' : ''}`}>
                  <span className="text-xs text-slate-400">{r.label}</span>
                  <span className={`text-sm font-semibold ${r.cls}`}>{r.value}</span>
                </div>
              ))}
            </div>
            {/* Extra time is a SEPARATE online payment, made when it was
                added — kept out of "Cash Due" above since it's already
                settled independently of the main booking payment. */}
            {b.extra_time_mins > 0 && (
              <div className="mt-3 rounded-2xl px-4 py-3 flex items-center gap-3 bg-violet-50 border border-violet-200">
                <span className="text-lg">⏱️</span>
                <div className="flex-1">
                  <p className="text-xs font-black text-violet-700">+{b.extra_time_mins} min Extra Time</p>
                  <p className="text-[11px] text-slate-500">
                    {b.extra_time_payment_status === 'paid'
                      ? 'Paid separately online ✓ — not part of cash due'
                      : 'Payment pending'}
                  </p>
                </div>
                <span className={`text-sm font-black px-2.5 py-1 rounded-full ${
                  b.extra_time_payment_status === 'paid'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-amber-100 text-amber-700'}`}>
                  ₹{b.extra_time_price.toLocaleString('en-IN')}
                </span>
              </div>
            )}
          </div>

          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Customer</p>
            <div className="rounded-2xl px-4 py-4 space-y-2 bg-slate-50 border border-slate-200">
              {[
                { label: 'Name',     value: b.customer },
                { label: 'Phone',    value: b.customer_phone },
                { label: 'Location', value: `${b.area}, ${b.city}` },
              ].map(r => (
                <div key={r.label} className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">{r.label}</span>
                  <span className="text-sm text-slate-800 font-medium">{r.value}</span>
                </div>
              ))}
            </div>
          </div>

          {b.special_instructions && (
            <div className="rounded-2xl px-4 py-3 bg-amber-50 border border-amber-200">
              <p className="text-[10px] font-black uppercase tracking-wider text-amber-600 mb-1">Instructions</p>
              <p className="text-sm text-slate-600">{b.special_instructions}</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Main Page ──────────────────────────────────────────────────
export default function AdminBookings() {
  const [bookings,  setBookings]  = useState<Booking[]>([])
  const [workers,   setWorkers]   = useState<Worker[]>([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [profile,   setProfile]   = useState<'all'|'live'|'completed'|'cancelled'>('all')
  const [filter,    setFilter]    = useState('all')
  const [selected,  setSelected]  = useState<Booking | null>(null)
  const [mapFor,    setMapFor]    = useState<Booking | null>(null)
  const [assignMap, setAssignMap] = useState<Record<string,string>>({})
  const [assigning, setAssigning] = useState<string | null>(null)
  const supabase = createClient()

  const slimBookings = bookings
    .filter(b => ['pending','accepted','in_progress'].includes(b.status))
    .map(b => ({ worker_id: b.worker_id ?? '', scheduled_at: b.scheduled_at }))

  const load = useCallback(async () => {
    const todayStr = (() => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })()

    const [{ data: bd }, { data: wd }, { data: availData }, { data: activeJobs }, { data: schedDateRows }] =
      await Promise.all([
        supabase.from('bookings').select(
          `id,status,final_amount,base_price,discount_amount,scheduled_at,created_at,
           otp,worker_id,payment_status,special_instructions,work_started_at,work_ended_at,booking_duration_minutes,
           service_duration_minutes,
           extra_time_mins,extra_time_price,extra_time_payment_status,
           customer_id,
           services(name,duration_minutes),addresses(area,city),
           customer:users!customer_id(full_name,phone),
           worker:users!worker_id(full_name,phone),
           booking_items(quantity,unit_price,total_price,service_name,services(name))`
        ).order('created_at', { ascending: false }),
        supabase.from('users').select('id,full_name,phone').eq('role','worker').order('full_name'),
        supabase.from('workers').select('user_id,is_available'),
        supabase.from('bookings').select('worker_id').eq('status','in_progress'),
        supabase.from('worker_schedule_dates')
          .select('worker_id,date,enabled,start_time,end_time,breaks')
          .gte('date', todayStr),
      ])

    const availMap: Record<string,boolean> = {}
    ;(availData ?? []).forEach((w: any) => { availMap[w.user_id] = w.is_available })

    // Group date-specific schedule rows by worker, then by date.
    const scheduleDatesMap: Record<string, Record<string, any>> = {}
    ;(schedDateRows ?? []).forEach((r: any) => {
      if (!scheduleDatesMap[r.worker_id]) scheduleDatesMap[r.worker_id] = {}
      scheduleDatesMap[r.worker_id][r.date] = {
        enabled: r.enabled === true,
        start: r.start_time ?? '09:00',
        end: r.end_time ?? '17:00',
        breaks: r.breaks ?? [],
      }
    })

    const busySet = new Set<string>()
    ;(activeJobs ?? []).forEach((b: any) => { if (b.worker_id) busySet.add(b.worker_id) })

    if (bd) setBookings(bd.map((b: any) => {
      // Every service booked in this order. Prefers the snapshotted
      // booking_items.service_name (stable even if the service is later
      // renamed/removed), falls back to the live booking_items.services.name
      // join, and finally falls back to the single bookings.services.name
      // join for older non-cart bookings that have no booking_items rows.
      const items = (b.booking_items ?? []) as any[]
      const servicesList: BookedService[] = items.length > 0
        ? items.map((it: any) => ({
            name: it.service_name ?? it.services?.name ?? 'Service',
            qty: it.quantity ?? 1,
            unit_price: it.unit_price ?? 0,
          }))
        : [{
            name: b.services?.name ?? 'Service',
            qty: 1,
            unit_price: b.base_price ?? 0,
          }]
      const serviceNameLabel = servicesList
        .map(s => s.qty > 1 ? `${s.name} ×${s.qty}` : s.name)
        .join(', ')

      return {
        id: b.id, status: b.status,
        final_amount: b.final_amount ?? 0, base_price: b.base_price ?? 0,
        discount_amount: b.discount_amount ?? 0,
        scheduled_at: b.scheduled_at, created_at: b.created_at,
        otp: b.otp ?? '—', worker_id: b.worker_id ?? null,
        payment_status: b.payment_status ?? 'pending',
        special_instructions: b.special_instructions ?? null,
        work_started_at: b.work_started_at ?? null,
        work_ended_at: b.work_ended_at ?? null,
        booking_duration_minutes: b.booking_duration_minutes ?? null,
        service_duration_minutes: b.service_duration_minutes ?? null,
        extra_time_mins: b.extra_time_mins ?? 0,
        extra_time_price: b.extra_time_price ?? 0,
        extra_time_payment_status: b.extra_time_payment_status ?? null,
        service_name: serviceNameLabel,
        services: servicesList,
        service_duration: b.services?.duration_minutes ?? 60,
        customer: b.customer?.full_name ?? 'Customer',
        customer_id: b.customer_id ?? '',
        customer_phone: b.customer?.phone ?? '—',
        worker: b.worker?.full_name ?? 'Unassigned',
        worker_phone: b.worker?.phone ?? '',
        area: b.addresses?.area ?? '—',
        city: b.addresses?.city ?? '',
      }
    }))

    if (wd) setWorkers(wd.map((w: any) => ({
      id: w.id, name: w.full_name ?? 'Unknown', phone: w.phone ?? '',
      is_available: availMap[w.id] !== undefined ? availMap[w.id] : true,
      is_busy: busySet.has(w.id),
      scheduleDates: scheduleDatesMap[w.id] ?? null,
      hasAnyScheduleDates: !!scheduleDatesMap[w.id],
    })))

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const ch = supabase.channel('bkng')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        load()
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
    // subscribe ONCE — depending on `bookings` here re-subscribes on every
    // change and throws "cannot add postgres_changes callbacks after subscribe()"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // keep the open drawer in sync with fresh data (by id) without
  // re-subscribing realtime
  useEffect(() => {
    setSelected(prev => (prev ? (bookings.find(b => b.id === prev.id) ?? prev) : prev))
  }, [bookings])

  async function quickAssign(bId: string) {
    const wId = assignMap[bId]; if (!wId) return
    setAssigning(bId)
    await supabase.from('bookings')
      .update({ worker_id: wId, status: 'accepted' })
      .eq('id', bId)
    const bk = bookings.find(b => b.id === bId)
    if (bk) {
      const scheduledStr = new Date(bk.scheduled_at).toLocaleString('en-IN', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      })
      await sendNotification(
        bk.customer_id, '✅ Booking Confirmed!',
        `Your ${bk.service_name} is scheduled for ${scheduledStr}. A verified pro has been assigned.`,
        { booking_id: bId, type: 'booking_assigned' }
      )
    }
    await load(); setAssigning(null)
    setAssignMap(p => { const n = { ...p }; delete n[bId]; return n })
  }

  async function quickAct(bId: string, status: string) {
    const now = new Date().toISOString()
    const u: any = { status }
    if (status === 'completed') {
      u.work_ended_at = now; u.payment_status = 'paid'
      const bk = bookings.find(b => b.id === bId)
      if (bk?.work_started_at) u.work_duration_seconds = Math.floor(
        (new Date(now).getTime() - new Date(bk.work_started_at).getTime()) / 1000)
    }
    if (status === 'cancelled') u.work_ended_at = now
    await supabase.from('bookings').update(u).eq('id', bId)
    const bk = bookings.find(b => b.id === bId)
    if (bk) {
      if (status === 'completed') {
        await sendNotification(
          bk.customer_id, '🎉 Cleaning Complete!',
          `Your ${bk.service_name} is done. Hope you love it! Please rate your experience.`,
          { booking_id: bId, type: 'booking_completed' }
        )
      }
      if (status === 'cancelled') {
        await sendNotification(
          bk.customer_id, '❌ Booking Cancelled',
          `Your ${bk.service_name} booking has been cancelled. Contact us for support.`,
          { booking_id: bId, type: 'booking_cancelled' }
        )
      }
    }
    await load(); if (selected?.id === bId) setSelected(null)
  }

  const liveStatuses      = ['pending','accepted','otp_verified','in_progress']
  const completedStatuses = ['completed']
  const cancelledStatuses = ['cancelled']

  function profileFilter(b: Booking) {
    if (profile === 'live')      return liveStatuses.includes(b.status)
    if (profile === 'completed') return completedStatuses.includes(b.status)
    if (profile === 'cancelled') return cancelledStatuses.includes(b.status)
    return true
  }

  const filtered = bookings.filter(b => {
    const q = search.toLowerCase()
    const matchSearch = b.service_name.toLowerCase().includes(q) ||
      b.customer.toLowerCase().includes(q) ||
      b.customer_phone.includes(q) || b.worker.toLowerCase().includes(q)
    const matchStatus = filter === 'all' || b.status === filter
    return matchSearch && matchStatus && profileFilter(b)
  })

  const liveCount      = bookings.filter(b => liveStatuses.includes(b.status)).length
  const completedCount = bookings.filter(b => b.status === 'completed').length
  const cancelledCount = bookings.filter(b => b.status === 'cancelled').length
  const liveRevenue    = bookings.filter(b => b.status === 'in_progress').reduce((s,b) => s + b.final_amount, 0)
  const completedRev   = bookings.filter(b => b.status === 'completed').reduce((s,b) => s + b.final_amount, 0)
  const cancelledRev   = bookings.filter(b => b.status === 'cancelled').reduce((s,b) => s + b.final_amount, 0)
  const inProgressNow  = bookings.filter(b => b.status === 'in_progress').length

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin border-slate-200"
          style={{ borderTopColor: '#0891B2' }}/>
        <p className="text-sm text-slate-400">Loading bookings…</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen px-4 md:px-8 py-7 bg-slate-50">

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl"
            style={{ background: '#0891B214', border: '1px solid #0891B225' }}>📋</div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 leading-tight tracking-tight">Bookings</h1>
            <p className="text-xs text-slate-400 font-medium">{bookings.length} total · {inProgressNow} working now</p>
          </div>
        </div>
        <input type="text" placeholder="Search service, customer, phone, worker…" value={search} onChange={e => setSearch(e.target.value)}
          className="px-4 py-2.5 rounded-xl text-sm text-slate-800 placeholder-slate-400 outline-none bg-white border border-slate-200 w-full md:w-72"/>
      </div>

      {/* Profile tabs */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { key: 'live',      icon: '⚡', label: 'Live / Active', count: liveCount, rev: liveRevenue, revLabel: 'ongoing',
            activeGrad: 'linear-gradient(135deg,#0891B2,#0E7490)', activeBorder: '#0891B2', activeShadow: 'rgba(8,145,178,0.3)',
            idleBorder: '#BAE6FD', textColor: '#0891B2', extra: inProgressNow > 0 ? `${inProgressNow} working` : null },
          { key: 'completed', icon: '✅', label: 'Completed', count: completedCount, rev: completedRev, revLabel: 'earned',
            activeGrad: 'linear-gradient(135deg,#059669,#047857)', activeBorder: '#059669', activeShadow: 'rgba(5,150,105,0.3)',
            idleBorder: '#A7F3D0', textColor: '#059669', extra: null },
          { key: 'cancelled', icon: '❌', label: 'Cancelled', count: cancelledCount, rev: cancelledRev, revLabel: 'lost',
            activeGrad: 'linear-gradient(135deg,#DC2626,#B91C1C)', activeBorder: '#DC2626', activeShadow: 'rgba(220,38,38,0.3)',
            idleBorder: '#FECACA', textColor: '#DC2626', extra: null },
        ].map(tab => {
          const active = profile === tab.key
          return (
            <button key={tab.key}
              onClick={() => { setProfile(active ? 'all' : tab.key as any); setFilter('all') }}
              className="rounded-2xl p-3.5 text-left transition-all hover:shadow-md active:scale-[0.98] relative overflow-hidden"
              style={{
                background: active ? tab.activeGrad : '#fff',
                border:     `1.5px solid ${active ? tab.activeBorder : tab.idleBorder}`,
                boxShadow:  active ? `0 8px 24px ${tab.activeShadow}` : '0 1px 4px rgba(0,0,0,0.04)',
              }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-base">{tab.icon}</span>
                {tab.extra && (
                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
                    style={{ background: active ? 'rgba(255,255,255,0.2)' : '#CFFAFE',
                      color: active ? '#fff' : tab.textColor }}>
                    {tab.extra}
                  </span>
                )}
              </div>
              <p className="text-xl font-black leading-none mb-0.5"
                style={{ color: active ? '#fff' : tab.textColor }}>{tab.count}</p>
              <p className="text-[11px] font-bold"
                style={{ color: active ? 'rgba(255,255,255,0.8)' : '#64748B' }}>{tab.label}</p>
              <p className="text-[10px] mt-0.5 font-mono"
                style={{ color: active ? 'rgba(255,255,255,0.6)' : '#94A3B8' }}>
                ₹{tab.rev.toLocaleString('en-IN')} {tab.revLabel}
              </p>
            </button>
          )
        })}
      </div>

      {/* Status pills */}
      {profile === 'all' && (
        <div className="flex gap-2 overflow-x-auto pb-3 mb-3">
          {Object.entries(STATUS).map(([k, v]) => {
            const cnt = bookings.filter(b => b.status === k).length
            if (!cnt && k !== 'pending') return null
            return (
              <button key={k} onClick={() => setFilter(filter === k ? 'all' : k)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap flex-shrink-0 transition-all"
                style={{
                  background: filter === k ? v.bg : '#fff',
                  color:      filter === k ? v.color : '#64748B',
                  border:     `1px solid ${filter === k ? v.color+'40' : '#E2E8F0'}`,
                }}>
                {v.icon} {cnt} {v.label}
              </button>
            )
          })}
        </div>
      )}

      {profile === 'live' && (
        <div className="flex gap-2 overflow-x-auto pb-3 mb-3">
          {['all',...liveStatuses].map(k => {
            const v   = STATUS[k]
            const cnt = k === 'all' ? liveCount : bookings.filter(b => b.status === k).length
            if (!cnt && k !== 'all') return null
            return (
              <button key={k} onClick={() => setFilter(k)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap flex-shrink-0 transition-all"
                style={{
                  background: filter === k ? (v?.bg ?? '#CFFAFE') : '#fff',
                  color:      filter === k ? (v?.color ?? '#0891B2') : '#64748B',
                  border:     `1px solid ${filter === k ? (v?.color ?? '#0891B2')+'40' : '#E2E8F0'}`,
                }}>
                {v?.icon ?? '⚡'} {cnt} {v?.label ?? 'All Live'}
              </button>
            )
          })}
        </div>
      )}

      {/* ── DENSE TABLE ── */}
      <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                {['Service / Customer','Location','Schedule','Status','Worker','Amount','Timer','Actions'].map(c => (
                  <th key={c} className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wide whitespace-nowrap">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(b => {
                const cfg         = STATUS[b.status] ?? STATUS.pending
                const needsW      = !b.worker_id && ['pending','accepted'].includes(b.status)
                const isLive      = b.status === 'in_progress'
                const isDone      = b.status === 'completed' && b.work_started_at && b.work_ended_at
                const isCancelled = b.status === 'cancelled'
                const totalSec    = isDone ? elapsed(b.work_started_at, b.work_ended_at) : 0
                const slotAvailable = workers.filter(w =>
                  isWorkerAvailableAt(w, b.scheduled_at, b.service_duration || 60, slimBookings)
                )

                return (
                  <Fragment key={b.id}>
                    <tr
                      className="border-b border-slate-50 hover:bg-slate-50/70 transition-colors cursor-pointer"
                      onClick={() => setSelected(b)}
                      style={{ opacity: isCancelled ? 0.7 : 1 }}>
                      {/* Service / Customer */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          {isLive && <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse flex-shrink-0"/>}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="font-bold text-slate-800 text-[13px] truncate max-w-[180px]">{b.service_name}</p>
                              {b.services.length > 1 && (
                                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-cyan-50 text-cyan-700 border border-cyan-200 flex-shrink-0">
                                  {b.services.length}
                                </span>
                              )}
                              {b.extra_time_mins > 0 && (
                                <span
                                  title={b.extra_time_payment_status === 'paid' ? 'Extra time paid online' : 'Extra time payment pending'}
                                  className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 flex-shrink-0">
                                  +{b.extra_time_mins}m {b.extra_time_payment_status === 'paid' ? '✓' : '⏳'}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-400 truncate max-w-[180px]">
                              {b.customer} · {b.area}
                            </p>
                          </div>
                        </div>
                      </td>
                      {/* Location */}
                      <td className="px-4 py-3.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-semibold text-slate-600">📍 {b.area}</span>
                          <button
                            onClick={() => setMapFor(b)}
                            className="px-2 py-1 rounded-lg text-[11px] font-bold bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100 transition-all">
                            Map
                          </button>
                        </div>
                      </td>
                      {/* Schedule */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <p className="text-[13px] text-slate-700 font-medium">
                          {new Date(b.scheduled_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {new Date(b.scheduled_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </td>
                      {/* Status */}
                      <td className="px-4 py-3.5">
                        <span className="text-[11px] font-bold px-2 py-1 rounded-full whitespace-nowrap"
                          style={{ background: cfg.bg, color: cfg.color }}>
                          {cfg.icon} {cfg.label}
                        </span>
                      </td>
                      {/* Worker */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {b.worker !== 'Unassigned'
                          ? <span className="text-[12px] font-semibold text-slate-700">👷 {b.worker.split(' ')[0]}</span>
                          : <span className="text-[11px] text-amber-600 font-bold">Unassigned</span>}
                      </td>
                      {/* Amount */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className={`text-[13px] font-black ${isCancelled ? 'text-red-400 line-through' : 'text-cyan-700'}`}>
                          ₹{b.final_amount.toLocaleString('en-IN')}
                        </span>
                      </td>
                      {/* Timer */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {isLive && b.work_started_at
                          ? <LiveTimer start={b.work_started_at} end={null} color="#0891B2"/>
                          : isDone && totalSec > 0
                            ? <span className="font-mono font-bold text-[12px] text-green-700">{durShort(totalSec)}</span>
                            : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                      {/* Actions */}
                      <td className="px-4 py-3.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          {b.status === 'in_progress' && (
                            <button onClick={() => quickAct(b.id,'completed')}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-green-100 text-green-700 border border-green-200 hover:bg-green-200 transition-all">
                              ✓ Done
                            </button>
                          )}
                          {['pending','accepted','otp_verified','in_progress'].includes(b.status) && (
                            <button onClick={() => quickAct(b.id,'cancelled')}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black bg-red-50 text-red-500 border border-red-200 hover:bg-red-100 transition-all">✕</button>
                          )}
                          <button onClick={() => setSelected(b)}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all">
                            Details
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Inline assign row (only when needs worker) */}
                    {needsW && (
                      <tr className="border-b border-slate-50 bg-amber-50/40">
                        <td colSpan={8} className="px-4 py-2" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-slate-500 font-medium whitespace-nowrap">
                              {slotAvailable.length > 0
                                ? `${slotAvailable.length} free at this slot:`
                                : 'No workers free at this slot'}
                            </span>
                            <select value={assignMap[b.id] ?? ''} onChange={e => setAssignMap(p => ({ ...p, [b.id]: e.target.value }))}
                              className="flex-1 max-w-xs px-3 py-1.5 rounded-lg text-[13px] text-slate-800 outline-none bg-white"
                              style={{ border: `1.5px solid ${slotAvailable.length > 0 ? '#FCD34D' : '#FECACA'}` }}>
                              <option value="">{slotAvailable.length === 0 ? 'No workers free' : 'Assign worker…'}</option>
                              {slotAvailable.map(w => (
                                <option key={w.id} value={w.id}>{w.name} — {w.phone}</option>
                              ))}
                            </select>
                            <button onClick={() => quickAssign(b.id)}
                              disabled={!assignMap[b.id] || assigning === b.id || slotAvailable.length === 0}
                              className="px-3 py-1.5 rounded-lg text-[11px] font-black text-white disabled:opacity-40 active:scale-95 whitespace-nowrap"
                              style={{ background: 'linear-gradient(135deg,#0891B2,#4F46E5)' }}>
                              {assigning === b.id ? '…' : 'Assign 🔔'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="p-16 text-center">
            <p className="text-4xl mb-3">
              {profile === 'live' ? '⚡' : profile === 'completed' ? '✅' : profile === 'cancelled' ? '❌' : '📋'}
            </p>
            <p className="text-slate-700 font-bold">
              {profile === 'live' ? 'No active bookings' : profile === 'completed' ? 'No completed bookings'
                : profile === 'cancelled' ? 'No cancelled bookings' : 'No bookings found'}
            </p>
            <p className="text-sm text-slate-400 mt-1">
              {profile !== 'all'
                ? <button onClick={() => setProfile('all')} className="text-cyan-600 font-bold hover:underline">View all bookings</button>
                : 'Try changing the filter'}
            </p>
          </div>
        )}
      </div>

      {/* Quick location + nearby workers popup (from the row Map button) */}
      {mapFor && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => setMapFor(null)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <div>
                <p className="font-black text-slate-800 text-sm">{mapFor.service_name}</p>
                <p className="text-[11px] text-slate-400">
                  📍 {mapFor.area}, {mapFor.city} · {mapFor.customer}
                </p>
              </div>
              <button onClick={() => setMapFor(null)}
                className="w-8 h-8 rounded-lg flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all">✕</button>
            </div>
            <div className="p-4">
              <AssignMap
                bookingId={mapFor.id}
                selectedWorkerId={assignMap[mapFor.id] ?? ''}
                onSelectWorker={(id) => setAssignMap(p => ({ ...p, [mapFor.id]: id }))}
              />
              {['pending','accepted'].includes(mapFor.status) && (
                <button
                  onClick={async () => { await quickAssign(mapFor.id); setMapFor(null) }}
                  disabled={!assignMap[mapFor.id] || assigning === mapFor.id}
                  className="w-full mt-3 h-11 rounded-xl font-black text-sm text-white disabled:opacity-40 active:scale-[0.98] transition-all"
                  style={{ background: 'linear-gradient(135deg,#0891B2,#4F46E5)' }}>
                  {assigning === mapFor.id ? '…' : 'Assign selected worker + Notify 🔔'}
                </button>
              )}
              <button onClick={() => { setSelected(mapFor); setMapFor(null) }}
                className="w-full mt-2 h-10 rounded-xl font-bold text-[13px] bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all">
                Open full details
              </button>
            </div>
          </div>
        </>
      )}

      {selected && (
        <Drawer
          b={selected}
          workers={workers}
          allBookings={slimBookings}
          onClose={() => setSelected(null)}
          onDone={() => { load(); setSelected(null) }}
        />
      )}
    </div>
  )
}