'use client'
import { useEffect, useState, useCallback, useRef, Fragment } from 'react'
import { createClient } from '@/lib/supabase/client'
import AssignMap from './assign_map'
import RecurringPackageBadge from './recurring_package_badge'
import AddressMapPicker, { type PickedAddress } from '../../components/AddressMapPicker'

type BookedService = { serviceId: string | null; name: string; qty: number; unit_price: number }

type Booking = {
  id: string; status: string; final_amount: number; base_price: number
  discount_amount: number; scheduled_at: string; created_at: string
  service_name: string; service_duration: number
  services: BookedService[]
  customer: string; customer_id: string; customer_phone: string
  worker: string; worker_id: string | null; worker_phone: string
  area: string; city: string; full_address: string; flat_no: string; building: string; pincode: string; latitude: number|null; longitude: number|null; otp: string; payment_status: string
  special_instructions: string | null
  work_started_at: string | null; work_ended_at: string | null
  booking_duration_minutes: number | null
  service_duration_minutes: number | null
  extra_time_mins: number; extra_time_price: number
  extra_time_payment_status: string | null
  is_manual_booking: boolean
}
type Worker = {
  id: string; name: string; phone: string
  is_available: boolean; is_busy: boolean
  scheduleDates: Record<string, { enabled: boolean; start: string; end: string; breaks: { from: string; to: string }[] }> | null
  hasAnyScheduleDates: boolean
}

type ServiceOption = { id: string; name: string; duration_minutes: number; base_price: number | null }

type SavedAddress = {
  id: string
  label: string | null
  flat_no: string | null
  building: string | null
  area: string | null
  city: string | null
  full_address: string | null
  pincode: string | null
  is_default: boolean
  latitude: number | null
  longitude: number | null
}
type CustomerMatch = {
  id: string
  full_name: string | null
  addresses: SavedAddress[]
}

const SYSTEM_PLACEHOLDER_ID = '00000000-0000-0000-0000-000000000001'

const STATUS: Record<string, { label: string; color: string; bg: string; icon: string; step: number }> = {
  pending:      { label: 'Pending',      color: '#D97706', bg: '#FEF3C7', icon: '⏳', step: 0 },
  accepted:     { label: 'Assigned',     color: '#2563EB', bg: '#DBEAFE', icon: '👤', step: 1 },
  otp_verified: { label: 'OTP Verified', color: '#7C3AED', bg: '#EDE9FE', icon: '🔓', step: 2 },
  in_progress:  { label: 'In Progress',  color: '#0891B2', bg: '#CFFAFE', icon: '⚡', step: 3 },
  completed:    { label: 'Completed',    color: '#059669', bg: '#D1FAE5', icon: '✓',  step: 4 },
  cancelled:    { label: 'Cancelled',    color: '#DC2626', bg: '#FEE2E2', icon: '✕',  step: -1 },
}
const STEPS = ['pending','accepted','otp_verified','in_progress','completed']

function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  if (digits.length !== 10) return raw.trim()
  return `+91${digits}`
}

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

function localDateStr(d: Date): string {
  const local = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function labelFromDateInput(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  return `${d} ${MONTH_ABBR[m - 1]} ${y}`
}

const TIME_SLOTS = [
  '07:00 AM','07:30 AM','08:00 AM','08:30 AM','09:00 AM','09:30 AM','10:00 AM','10:30 AM','11:00 AM','11:30 AM',
  '12:00 PM','12:30 PM','01:00 PM','01:30 PM','02:00 PM','02:30 PM','03:00 PM','03:30 PM',
  '04:00 PM','04:30 PM','05:00 PM','05:30 PM','06:00 PM','06:30 PM','07:00 PM',
]
const SLOT_GROUPS: { label: string; slots: string[] }[] = [
  { label: 'Morning',   slots: TIME_SLOTS.slice(0, 10) },
  { label: 'Afternoon', slots: TIME_SLOTS.slice(10, 18) },
  { label: 'Evening',   slots: TIME_SLOTS.slice(18) },
]

function slotToDateTime(date: Date, slot: string): Date {
  const [time, period] = slot.split(' ')
  let [hh, mm] = time.split(':').map(Number)
  if (period === 'PM' && hh !== 12) hh += 12
  if (period === 'AM' && hh === 12) hh = 0
  const d = new Date(date)
  d.setHours(hh, mm, 0, 0)
  return d
}

function nextDays(n: number): Date[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + i)
    return d
  })
}

function isWorkerAvailableAt(
  worker: Worker, scheduledAt: string, durationMins: number,
  existingBookings: { worker_id: string; scheduled_at: string }[]
): boolean {
  if (!worker.is_available) return false
  const slotDt    = new Date(scheduledAt)
  const slotEnd   = new Date(slotDt.getTime() + durationMins * 60000)
  const localSlot = new Date(slotDt.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))

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
    return false
  }

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

function SlotPicker({
  workers, durationMins, existingBookings, value, onChange, emptyHint,
}: {
  workers: Worker[]
  durationMins: number
  existingBookings: { worker_id: string; scheduled_at: string }[]
  value: string
  onChange: (iso: string) => void
  emptyHint?: string
}) {
  const supabase = createClient()
  const dates = nextDays(7)
  const [selectedDate, setSelectedDate] = useState<Date>(dates[0])
  const [availability, setAvailability] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(false)

  const selectedSlot = (() => {
    if (!value) return ''
    const d = new Date(value)
    if (localDateStr(d) !== localDateStr(selectedDate)) return ''
    const found = TIME_SLOTS.find(s => {
      const sd = slotToDateTime(selectedDate, s)
      return Math.abs(sd.getTime() - d.getTime()) < 60000
    })
    return found ?? ''
  })()

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (workers.length === 0 || durationMins <= 0) { setAvailability({}); return }
      setLoading(true)
      const dateStr = localDateStr(selectedDate)
      const { data: holidays } = await supabase
        .from('worker_holidays').select('worker_id').eq('holiday_date', dateStr)
      const holidayIds = new Set((holidays ?? []).map((h: any) => h.worker_id as string))
      const eligible = workers.filter(w => !holidayIds.has(w.id))
      const now = new Date()
      const cutoff = new Date(now.getTime() + 30 * 60000)
      const avail: Record<string, boolean> = {}
      for (const slot of TIME_SLOTS) {
        const slotDt = slotToDateTime(selectedDate, slot)
        if (slotDt < cutoff) { avail[slot] = false; continue }
        avail[slot] = eligible.some(w =>
          isWorkerAvailableAt(w, slotDt.toISOString(), durationMins, existingBookings))
      }
      if (!cancelled) { setAvailability(avail); setLoading(false) }
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate.getTime(), workers, durationMins, existingBookings])

  const availableCount = Object.values(availability).filter(Boolean).length

  if (workers.length === 0) {
    return (
      <div className="rounded-xl px-4 py-3 text-center bg-amber-50 border border-amber-200">
        <p className="text-xs font-bold text-amber-700">
          {emptyHint ?? 'No eligible workers to check availability against yet.'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {dates.map((d, i) => {
          const active = localDateStr(d) === localDateStr(selectedDate)
          const isToday = i === 0
          return (
            <button key={d.toISOString()} type="button"
              onClick={() => setSelectedDate(d)}
              className="flex-shrink-0 w-14 py-2 rounded-xl text-center transition-all"
              style={{
                background: active ? 'linear-gradient(135deg,#0891B2,#0E7490)' : '#F8FAFC',
                border: `1.5px solid ${active ? '#0891B2' : '#E2E8F0'}`,
              }}>
              <p className="text-[9px] font-bold" style={{ color: active ? '#DFFAFE' : '#94A3B8' }}>
                {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][(d.getDay() + 6) % 7]}
              </p>
              <p className="text-lg font-black" style={{ color: active ? '#fff' : '#1E293B' }}>
                {d.getDate()}
              </p>
              <p className="text-[8px] font-black" style={{ color: active ? '#fff' : isToday ? '#0891B2' : 'transparent' }}>
                {isToday ? 'TODAY' : '·'}
              </p>
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-[10px] text-slate-500">
            <span className="w-2 h-2 rounded-full bg-cyan-500 inline-block"/> Available
          </span>
          <span className="flex items-center gap-1 text-[10px] text-slate-500">
            <span className="w-2 h-2 rounded-full bg-slate-200 inline-block"/> Full
          </span>
        </div>
        <span className="text-[10px] text-slate-400">
          {loading ? 'Checking…' : `${availableCount} slot${availableCount === 1 ? '' : 's'} available`}
        </span>
      </div>

      {loading ? (
        <div className="py-8 text-center text-xs text-slate-400">Checking worker availability…</div>
      ) : (
        <div className="space-y-3">
          {SLOT_GROUPS.map(group => (
            <div key={group.label}>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">{group.label}</p>
              <div className="grid grid-cols-4 gap-2">
                {group.slots.map(slot => {
                  const isAvail = availability[slot] ?? false
                  const active = selectedSlot === slot
                  return (
                    <button key={slot} type="button" disabled={!isAvail}
                      onClick={() => onChange(slotToDateTime(selectedDate, slot).toISOString())}
                      className="px-2 py-2 rounded-lg text-[11px] font-bold transition-all"
                      style={{
                        background: !isAvail ? '#F8FAFC' : active ? 'linear-gradient(135deg,#0891B2,#0E7490)' : '#fff',
                        color: !isAvail ? '#CBD5E1' : active ? '#fff' : '#334155',
                        border: `1px solid ${!isAvail ? '#E2E8F0' : active ? '#0891B2' : '#E2E8F0'}`,
                        cursor: isAvail ? 'pointer' : 'not-allowed',
                      }}>
                      {slot}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          {availableCount === 0 && (
            <div className="rounded-xl px-4 py-3 text-center bg-amber-50 border border-amber-200">
              <p className="text-xs font-bold text-amber-700">No slots available on this date — try another day.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function useCustomerLookup(rawPhone: string) {
  const supabase = createClient()
  const [match, setMatch] = useState<CustomerMatch | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    let cancelled = false
    const digits = rawPhone.replace(/\D/g, '')
    if (digits.length < 10) {
      setMatch(null)
      setChecking(false)
      return
    }
    const phone = normalizePhone(rawPhone)
    setChecking(true)
    const t = setTimeout(async () => {
      const { data: userRow } = await supabase
        .from('users')
        .select('id, full_name')
        .eq('phone', phone)
        .eq('role', 'customer')
        .eq('is_deleted', false)
        .maybeSingle()

      if (cancelled) return

      if (!userRow) {
        setMatch(null)
        setChecking(false)
        return
      }

      const { data: addrRows } = await supabase
        .from('addresses')
        .select('id,label,flat_no,building,area,city,full_address,pincode,is_default,latitude,longitude')
        .eq('user_id', userRow.id)
        .eq('is_deleted', false)
        .order('is_default', { ascending: false })

      if (cancelled) return

      setMatch({
        id: userRow.id,
        full_name: userRow.full_name,
        addresses: (addrRows ?? []) as SavedAddress[],
      })
      setChecking(false)
    }, 400)

    return () => { cancelled = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawPhone])

  return { match, checking }
}

function PhoneBookingModal({ services, workers, allBookings, onClose, onDone }: {
  services: ServiceOption[]
  workers: Worker[]
  allBookings: { worker_id: string; scheduled_at: string }[]
  onClose: () => void
  onDone: () => void
}) {
  const supabase = createClient()
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [serviceLines, setServiceLines] = useState<{ serviceId: string; quantity: number }[]>([
    { serviceId: '', quantity: 1 },
  ])
  const [finalAmount, setFinalAmount] = useState('')
  const [scheduledIso, setScheduledIso] = useState('')
  const [flatNo, setFlatNo] = useState('')
  const [building, setBuilding] = useState('')
  const [fullAddress, setFullAddress] = useState('')
  const [area, setArea] = useState('')
  const [city, setCity] = useState('')
  const [pincode, setPincode] = useState('')
  const [latitude, setLatitude] = useState<number | null>(null)
  const [longitude, setLongitude] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ bookingId: string; otp: string } | null>(null)

  const [zoneWorkerIds, setZoneWorkerIds] = useState<Set<string> | null>(null)
  const [zoneChecking, setZoneChecking] = useState(false)

  const { match: customerMatch, checking: customerChecking } = useCustomerLookup(phone)
  const [selectedAddressId, setSelectedAddressId] = useState<string>('')
  const [addingNewAddress, setAddingNewAddress] = useState(false)
  const nameTouchedRef = useRef(false)

  useEffect(() => {
    if (!customerMatch) {
      setSelectedAddressId('')
      setAddingNewAddress(false)
      return
    }
    if (!nameTouchedRef.current && customerMatch.full_name) {
      setName(customerMatch.full_name)
    }
    if (customerMatch.addresses.length > 0) {
      const def = customerMatch.addresses.find(a => a.is_default) ?? customerMatch.addresses[0]
      setSelectedAddressId(def.id)
      setAddingNewAddress(false)
    } else {
      setSelectedAddressId('')
      setAddingNewAddress(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerMatch?.id])

  useEffect(() => {
    if (!customerMatch || !selectedAddressId || addingNewAddress) return
    const addr = customerMatch.addresses.find(a => a.id === selectedAddressId)
    if (!addr) return
    setFlatNo(addr.flat_no ?? '')
    setBuilding(addr.building ?? '')
    setFullAddress(addr.full_address ?? '')
    setArea(addr.area ?? '')
    setCity(addr.city ?? '')
    setPincode(addr.pincode ?? '')
    setLatitude(addr.latitude ?? null)
    setLongitude(addr.longitude ?? null)
    setScheduledIso('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAddressId, addingNewAddress])

  function startNewAddress() {
    setAddingNewAddress(true)
    setSelectedAddressId('')
    setFlatNo(''); setBuilding(''); setFullAddress(''); setArea(''); setCity(''); setPincode('')
    setLatitude(null); setLongitude(null)
    setScheduledIso('')
  }

  function handleMapPick(picked: PickedAddress) {
    setLatitude(picked.lat)
    setLongitude(picked.lng)
    if (picked.fullAddress) setFullAddress(picked.fullAddress)
    if (picked.area) setArea(picked.area)
    if (picked.city) setCity(picked.city)
    if (picked.pincode) setPincode(picked.pincode)
  }

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      const p = pincode.trim()
      if (!p) { if (!cancelled) { setZoneWorkerIds(null); setZoneChecking(false) }; return }
      setZoneChecking(true)
      const ids = await resolvePincodeWorkerIds(supabase, p)
      if (!cancelled) { setZoneWorkerIds(ids); setZoneChecking(false) }
    }, 400)
    return () => { cancelled = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pincode])

  const filteredWorkers = zoneWorkerIds == null ? workers : workers.filter(w => zoneWorkerIds.has(w.id))

  function addServiceLine() {
    setServiceLines(prev => [...prev, { serviceId: '', quantity: 1 }])
    setScheduledIso('')
  }
  function removeServiceLine(idx: number) {
    setServiceLines(prev => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))
    setScheduledIso('')
  }
  function updateServiceLine(idx: number, patch: Partial<{ serviceId: string; quantity: number }>) {
    setServiceLines(prev => prev.map((line, i) => i === idx ? { ...line, ...patch } : line))
    setScheduledIso('')
  }

  const durationMins = serviceLines.reduce((sum, line) => {
    const svc = services.find(s => s.id === line.serviceId)
    if (!svc) return sum
    return sum + (svc.duration_minutes ?? 60) * Math.max(1, line.quantity)
  }, 0)

  const validLines = serviceLines.filter(l => l.serviceId)
  const finalAmountNum = Number(finalAmount)

  const canSubmit = phone.trim().length >= 10 && validLines.length > 0 && scheduledIso &&
    fullAddress.trim() && pincode.trim() &&
    finalAmount.trim() !== '' && finalAmountNum > 0

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_create_manual_booking', {
        p_customer_phone: normalizePhone(phone),
        p_customer_name: name.trim() || null,
        p_services: validLines.map(l => ({ service_id: l.serviceId, quantity: Math.max(1, l.quantity) })),
        p_scheduled_at: scheduledIso,
        p_final_amount: finalAmountNum,
        p_flat_no: flatNo.trim() || null,
        p_building: building.trim() || null,
        p_full_address: fullAddress.trim(),
        p_area: area.trim() || null,
        p_city: city.trim() || null,
        p_pincode: pincode.trim(),
        p_special_instructions: notes.trim() || null,
        p_latitude: latitude,
        p_longitude: longitude,
      })
      if (rpcError) { setError(rpcError.message); setSubmitting(false); return }
      if (!data?.success) {
        const reasonMap: Record<string, string> = {
          no_workers: 'No worker is available at this time slot for this pincode.',
          slot_full: 'This slot is already full — no free worker at that time.',
          no_services: 'Please add at least one service.',
          invalid_amount: 'Please enter a valid final amount.',
          service_not_found: 'One of the selected services could not be found.',
        }
        setError(reasonMap[data?.reason] ?? (data?.message || 'Could not create the booking.'))
        setSubmitting(false)
        return
      }
      setResult({ bookingId: data.booking_id, otp: data.otp })
      setSubmitting(false)
    } catch (e: any) {
      setError(e?.message ?? 'Could not create the booking.')
      setSubmitting(false)
    }
  }

  function addrLabel(a: SavedAddress): string {
    const main = a.label?.trim() || a.area || 'Address'
    const bits = [a.full_address || a.area, a.city].filter(Boolean).join(', ')
    return bits ? `${main} — ${bits}` : main
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose}/>
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-black text-slate-800">📞 Phone Booking</h2>
            <p className="text-xs text-slate-400 mt-0.5">Create a booking for a customer who called in</p>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-xl flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all">✕</button>
        </div>

        {result ? (
          <div className="px-6 py-6 space-y-4">
            <div className="rounded-2xl p-5 text-center bg-green-50 border border-green-200">
              <p className="text-3xl mb-2">✅</p>
              <p className="font-black text-slate-800">Booking created</p>
              <p className="text-xs text-slate-500 mt-1 font-mono">#{result.bookingId.slice(0,8).toUpperCase()}</p>
              <div className="mt-4 px-4 py-3 rounded-xl bg-white border border-green-200 inline-block">
                <p className="text-[10px] text-slate-400 mb-0.5">Booking OTP</p>
                <p className="font-mono font-black text-2xl text-green-700 tracking-widest">{result.otp}</p>
              </div>
            </div>
            <button onClick={onDone}
              className="w-full h-11 rounded-xl font-black text-sm text-white active:scale-[0.98] transition-all"
              style={{ background: 'linear-gradient(135deg,#0891B2,#4F46E5)' }}>
              Done
            </button>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Customer</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="relative">
                  <input type="tel" placeholder="Phone number *" value={phone}
                    onChange={e => setPhone(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
                  {customerChecking && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">…</span>
                  )}
                </div>
                <input type="text" placeholder="Name (if new customer)" value={name}
                  onChange={e => { nameTouchedRef.current = true; setName(e.target.value) }}
                  className="px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
              </div>

              {customerMatch ? (
                <div className="mt-2 px-3 py-2 rounded-xl bg-green-50 border border-green-200">
                  <p className="text-[11px] text-green-700 font-semibold">
                    ✓ Existing customer{customerMatch.full_name ? ` — ${customerMatch.full_name}` : ''}
                    {customerMatch.addresses.length > 0
                      ? ` · ${customerMatch.addresses.length} saved address${customerMatch.addresses.length === 1 ? '' : 'es'}`
                      : ' · no saved addresses yet'}
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-slate-400 mt-1.5">
                  We'll match an existing account by phone, or create a lightweight profile automatically.
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Services</p>
                <button type="button" onClick={addServiceLine}
                  className="text-[11px] font-bold text-cyan-700 hover:text-cyan-800">
                  + Add another service
                </button>
              </div>
              <div className="space-y-2">
                {serviceLines.map((line, idx) => (
                  <div key={idx} className="grid grid-cols-3 gap-3">
                    <select value={line.serviceId}
                      onChange={e => updateServiceLine(idx, { serviceId: e.target.value })}
                      className="col-span-2 px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200">
                      <option value="">Select service…</option>
                      {services.map(s => (
                        <option key={s.id} value={s.id}>{s.name}{s.base_price != null ? ` — ₹${s.base_price}` : ''}</option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <input type="number" min={1} value={line.quantity}
                        onChange={e => updateServiceLine(idx, { quantity: Math.max(1, Number(e.target.value)) })}
                        className="flex-1 px-3 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
                      {serviceLines.length > 1 && (
                        <button type="button" onClick={() => removeServiceLine(idx)}
                          className="w-9 h-9 flex-shrink-0 rounded-lg flex items-center justify-center bg-red-50 text-red-500 border border-red-200 hover:bg-red-100 transition-all">
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
                Final Amount (₹)
              </p>
              <input type="number" min={0} placeholder="Amount to charge — entered manually"
                value={finalAmount} onChange={e => setFinalAmount(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
              <p className="text-[11px] text-slate-400 mt-1.5">
                Entered by hand — independent of the selected services' catalog
                prices (covers phone-negotiated pricing).
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Address</p>
                {customerMatch && customerMatch.addresses.length > 0 && !addingNewAddress && (
                  <button type="button" onClick={startNewAddress}
                    className="text-[11px] font-bold text-cyan-700 hover:text-cyan-800">
                    + Add new address
                  </button>
                )}
                {customerMatch && addingNewAddress && customerMatch.addresses.length > 0 && (
                  <button type="button"
                    onClick={() => {
                      setAddingNewAddress(false)
                      const def = customerMatch.addresses.find(a => a.is_default) ?? customerMatch.addresses[0]
                      setSelectedAddressId(def.id)
                    }}
                    className="text-[11px] font-bold text-slate-500 hover:text-slate-700">
                    ← Use a saved address
                  </button>
                )}
              </div>

              {customerMatch && customerMatch.addresses.length > 0 && !addingNewAddress ? (
                <div className="mb-3">
                  <select value={selectedAddressId} onChange={e => setSelectedAddressId(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200">
                    {customerMatch.addresses.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.is_default ? '★ ' : ''}{addrLabel(a)}
                      </option>
                    ))}
                  </select>
                  {fullAddress && (
                    <p className="text-[11px] text-slate-400 mt-1.5">
                      📍 {[flatNo, building].filter(Boolean).join(', ')}{(flatNo || building) ? ' · ' : ''}{fullAddress}
                      {pincode ? ` — ${pincode}` : ''}
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <div className="mb-3">
                    <AddressMapPicker
                      onPick={handleMapPick}
                      initialLat={latitude}
                      initialLng={longitude}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <input type="text" placeholder="Flat / House no." value={flatNo} onChange={e => setFlatNo(e.target.value)}
                      className="px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
                    <input type="text" placeholder="Building / Society" value={building} onChange={e => setBuilding(e.target.value)}
                      className="px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
                  </div>
                  <input type="text" placeholder="Full address *" value={fullAddress} onChange={e => setFullAddress(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200 mb-3"/>
                  <div className="grid grid-cols-3 gap-3">
                    <input type="text" placeholder="Area" value={area} onChange={e => setArea(e.target.value)}
                      className="px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
                    <input type="text" placeholder="City" value={city} onChange={e => setCity(e.target.value)}
                      className="px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
                    <input type="text" placeholder="Pincode *" value={pincode}
                      onChange={e => { setPincode(e.target.value); setScheduledIso('') }}
                      className="px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
                  </div>
                </>
              )}
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Date & Time</p>
              {zoneChecking && (
                <p className="text-[11px] text-slate-400 mb-2">Checking worker coverage for this pincode…</p>
              )}
              {!zoneChecking && zoneWorkerIds != null && (
                <div className="mb-2 px-3 py-2 rounded-xl bg-cyan-50 border border-cyan-200">
                  <p className="text-[11px] text-cyan-700 font-semibold">
                    📐 {zoneWorkerIds.size} worker{zoneWorkerIds.size === 1 ? '' : 's'} cover pincode {pincode.trim()} —
                    availability below is checked against {zoneWorkerIds.size === 1 ? 'them' : 'only them'}.
                  </p>
                </div>
              )}
              <SlotPicker
                workers={filteredWorkers}
                durationMins={durationMins}
                existingBookings={allBookings}
                value={scheduledIso}
                onChange={setScheduledIso}
                emptyHint={
                  !pincode.trim()
                    ? 'Enter a pincode above to check real-time availability.'
                    : 'No worker covers this pincode yet — assign one under Workers → Areas.'
                }
              />
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Notes (optional)</p>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                placeholder="Anything the worker should know…"
                className="w-full px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200 resize-none"/>
            </div>

            {error && (
              <div className="rounded-xl px-3 py-2.5 bg-red-50 border border-red-200">
                <p className="text-xs font-bold text-red-600">{error}</p>
              </div>
            )}

            <button onClick={submit} disabled={!canSubmit || submitting}
              className="w-full h-11 rounded-xl font-black text-sm text-white disabled:opacity-40 active:scale-[0.98] transition-all"
              style={{ background: 'linear-gradient(135deg,#0891B2,#4F46E5)' }}>
              {submitting ? '…' : '📞 Create Phone Booking'}
            </button>
          </div>
        )}
      </div>
    </>
  )
}

function EditManualBookingModal({ booking, services, workers, allBookings, onClose, onDone }: {
  booking: Booking
  services: ServiceOption[]
  workers: Worker[]
  allBookings: { worker_id: string; scheduled_at: string }[]
  onClose: () => void
  onDone: () => void
}) {
  const supabase = createClient()
  const [phone, setPhone] = useState(booking.customer_phone ?? '')
  const [name, setName] = useState(booking.customer ?? '')
  const [serviceLines, setServiceLines] = useState<{ serviceId: string; quantity: number }[]>(
    booking.services.length > 0
      ? booking.services.map(s => ({ serviceId: s.serviceId ?? '', quantity: s.qty }))
      : [{ serviceId: '', quantity: 1 }]
  )
  const [finalAmount, setFinalAmount] = useState(String(booking.final_amount ?? ''))
  const [scheduledIso, setScheduledIso] = useState(booking.scheduled_at)
  const [flatNo, setFlatNo] = useState(booking.flat_no ?? '')
  const [building, setBuilding] = useState(booking.building ?? '')
  const [fullAddress, setFullAddress] = useState(booking.full_address ?? '')
  const [area, setArea] = useState(booking.area ?? '')
  const [city, setCity] = useState(booking.city ?? '')
  const [pincode, setPincode] = useState(booking.pincode ?? '')
  const [latitude, setLatitude] = useState<number | null>(booking.latitude ?? null)
  const [longitude, setLongitude] = useState<number | null>(booking.longitude ?? null)
  const [notes, setNotes] = useState(
    (booking.special_instructions ?? '')
      .replace(/\s*\[Phone booking (created|edited) by admin\]/g, '')
      .trim()
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const [zoneWorkerIds, setZoneWorkerIds] = useState<Set<string> | null>(null)
  const [zoneChecking, setZoneChecking] = useState(false)

  function handleMapPick(picked: PickedAddress) {
    setLatitude(picked.lat)
    setLongitude(picked.lng)
    if (picked.fullAddress) setFullAddress(picked.fullAddress)
    if (picked.area) setArea(picked.area)
    if (picked.city) setCity(picked.city)
    if (picked.pincode) setPincode(picked.pincode)
  }

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      const p = pincode.trim()
      if (!p) { if (!cancelled) { setZoneWorkerIds(null); setZoneChecking(false) }; return }
      setZoneChecking(true)
      const ids = await resolvePincodeWorkerIds(supabase, p)
      if (!cancelled) { setZoneWorkerIds(ids); setZoneChecking(false) }
    }, 400)
    return () => { cancelled = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pincode])

  const filteredWorkers = zoneWorkerIds == null ? workers : workers.filter(w => zoneWorkerIds.has(w.id))

  function addServiceLine() {
    setServiceLines(prev => [...prev, { serviceId: '', quantity: 1 }])
    setScheduledIso('')
  }
  function removeServiceLine(idx: number) {
    setServiceLines(prev => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))
    setScheduledIso('')
  }
  function updateServiceLine(idx: number, patch: Partial<{ serviceId: string; quantity: number }>) {
    setServiceLines(prev => prev.map((line, i) => i === idx ? { ...line, ...patch } : line))
    setScheduledIso('')
  }

  const durationMins = serviceLines.reduce((sum, line) => {
    const svc = services.find(s => s.id === line.serviceId)
    if (!svc) return sum
    return sum + (svc.duration_minutes ?? 60) * Math.max(1, line.quantity)
  }, 0)

  const validLines = serviceLines.filter(l => l.serviceId)
  const finalAmountNum = Number(finalAmount)

  const canSubmit = phone.trim().length >= 10 && validLines.length > 0 && scheduledIso &&
    fullAddress.trim() && pincode.trim() &&
    finalAmount.trim() !== '' && finalAmountNum > 0

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_edit_manual_booking', {
        p_booking_id: booking.id,
        p_customer_phone: normalizePhone(phone),
        p_customer_name: name.trim() || null,
        p_services: validLines.map(l => ({ service_id: l.serviceId, quantity: Math.max(1, l.quantity) })),
        p_scheduled_at: scheduledIso,
        p_final_amount: finalAmountNum,
        p_flat_no: flatNo.trim() || null,
        p_building: building.trim() || null,
        p_full_address: fullAddress.trim(),
        p_area: area.trim() || null,
        p_city: city.trim() || null,
        p_pincode: pincode.trim(),
        p_special_instructions: notes.trim() || null,
        p_latitude: latitude,
        p_longitude: longitude,
      })
      if (rpcError) { setError(rpcError.message); setSubmitting(false); return }
      if (!data?.success) {
        const reasonMap: Record<string, string> = {
          not_found: 'Booking not found.',
          not_manual_booking: 'Only phone bookings can be edited this way.',
          cannot_edit_status: 'This booking can no longer be edited (work has started, or it is finished/cancelled).',
          no_workers: 'No worker is available at this time slot for this pincode.',
          slot_full: 'This slot is already full — no free worker at that time.',
          no_services: 'Please add at least one service.',
          invalid_amount: 'Please enter a valid final amount.',
          service_not_found: 'One of the selected services could not be found.',
        }
        setError(reasonMap[data?.reason] ?? (data?.message || 'Could not save changes.'))
        setSubmitting(false)
        return
      }
      setDone(true)
      setSubmitting(false)
    } catch (e: any) {
      setError(e?.message ?? 'Could not save changes.')
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose}/>
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-black text-slate-800">✏️ Edit Phone Booking</h2>
            <p className="text-xs text-slate-400 mt-0.5">#{booking.id.slice(0,8).toUpperCase()}</p>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-xl flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all">✕</button>
        </div>

        {done ? (
          <div className="px-6 py-6 space-y-4">
            <div className="rounded-2xl p-5 text-center bg-green-50 border border-green-200">
              <p className="text-3xl mb-2">✅</p>
              <p className="font-black text-slate-800">Changes saved</p>
            </div>
            <button onClick={onDone}
              className="w-full h-11 rounded-xl font-black text-sm text-white active:scale-[0.98] transition-all"
              style={{ background: 'linear-gradient(135deg,#7C3AED,#4F46E5)' }}>
              Done
            </button>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Customer</p>
              <div className="grid grid-cols-2 gap-3">
                <input type="tel" placeholder="Phone number *" value={phone} onChange={e => setPhone(e.target.value)}
                  className="px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
                <input type="text" placeholder="Name" value={name} onChange={e => setName(e.target.value)}
                  className="px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Services</p>
                <button type="button" onClick={addServiceLine}
                  className="text-[11px] font-bold text-cyan-700 hover:text-cyan-800">
                  + Add another service
                </button>
              </div>
              <div className="space-y-2">
                {serviceLines.map((line, idx) => (
                  <div key={idx} className="grid grid-cols-3 gap-3">
                    <select value={line.serviceId}
                      onChange={e => updateServiceLine(idx, { serviceId: e.target.value })}
                      className="col-span-2 px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200">
                      <option value="">Select service…</option>
                      {services.map(s => (
                        <option key={s.id} value={s.id}>{s.name}{s.base_price != null ? ` — ₹${s.base_price}` : ''}</option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <input type="number" min={1} value={line.quantity}
                        onChange={e => updateServiceLine(idx, { quantity: Math.max(1, Number(e.target.value)) })}
                        className="flex-1 px-3 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
                      {serviceLines.length > 1 && (
                        <button type="button" onClick={() => removeServiceLine(idx)}
                          className="w-9 h-9 flex-shrink-0 rounded-lg flex items-center justify-center bg-red-50 text-red-500 border border-red-200 hover:bg-red-100 transition-all">
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
                Final Amount (₹)
              </p>
              <input type="number" min={0} value={finalAmount} onChange={e => setFinalAmount(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Address</p>
              <div className="mb-3">
                <AddressMapPicker
                  onPick={handleMapPick}
                  initialLat={latitude}
                  initialLng={longitude}
                />
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <input type="text" placeholder="Flat / House no." value={flatNo} onChange={e => setFlatNo(e.target.value)}
                  className="px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
                <input type="text" placeholder="Building / Society" value={building} onChange={e => setBuilding(e.target.value)}
                  className="px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
              </div>
              <input type="text" placeholder="Full address *" value={fullAddress} onChange={e => setFullAddress(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200 mb-3"/>
              <div className="grid grid-cols-3 gap-3">
                <input type="text" placeholder="Area" value={area} onChange={e => setArea(e.target.value)}
                  className="px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
                <input type="text" placeholder="City" value={city} onChange={e => setCity(e.target.value)}
                  className="px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
                <input type="text" placeholder="Pincode *" value={pincode}
                  onChange={e => { setPincode(e.target.value); setScheduledIso('') }}
                  className="px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Date & Time</p>
              {zoneChecking && (
                <p className="text-[11px] text-slate-400 mb-2">Checking worker coverage for this pincode…</p>
              )}
              {!zoneChecking && zoneWorkerIds != null && (
                <div className="mb-2 px-3 py-2 rounded-xl bg-cyan-50 border border-cyan-200">
                  <p className="text-[11px] text-cyan-700 font-semibold">
                    📐 {zoneWorkerIds.size} worker{zoneWorkerIds.size === 1 ? '' : 's'} cover pincode {pincode.trim()}.
                  </p>
                </div>
              )}
              <SlotPicker
                workers={filteredWorkers}
                durationMins={durationMins}
                existingBookings={allBookings.filter(bk => bk.scheduled_at !== booking.scheduled_at || bk.worker_id !== booking.worker_id)}
                value={scheduledIso}
                onChange={setScheduledIso}
                emptyHint={
                  !pincode.trim()
                    ? 'Enter a pincode above to check real-time availability.'
                    : 'No worker covers this pincode yet — assign one under Workers → Areas.'
                }
              />
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Notes (optional)</p>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                className="w-full px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200 resize-none"/>
            </div>

            {error && (
              <div className="rounded-xl px-3 py-2.5 bg-red-50 border border-red-200">
                <p className="text-xs font-bold text-red-600">{error}</p>
              </div>
            )}

            <button onClick={submit} disabled={!canSubmit || submitting}
              className="w-full h-11 rounded-xl font-black text-sm text-white disabled:opacity-40 active:scale-[0.98] transition-all"
              style={{ background: 'linear-gradient(135deg,#7C3AED,#4F46E5)' }}>
              {submitting ? '…' : '✏️ Save Changes'}
            </button>
          </div>
        )}
      </div>
    </>
  )
}

function BlockSlotModal({ workers, allBookings, onClose, onDone }: {
  workers: Worker[]
  allBookings: { worker_id: string; scheduled_at: string }[]
  onClose: () => void
  onDone: () => void
}) {
  const supabase = createClient()
  const [workerId, setWorkerId] = useState('')
  const [scheduledIso, setScheduledIso] = useState('')
  const [durationMins, setDurationMins] = useState(60)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const selectedWorker = workers.find(w => w.id === workerId)
  const filteredWorkers = selectedWorker ? [selectedWorker] : []

  const canSubmit = workerId && scheduledIso && durationMins > 0

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_block_slot', {
        p_worker_id: workerId,
        p_scheduled_at: scheduledIso,
        p_duration_minutes: durationMins,
        p_note: note.trim() || null,
      })
      if (rpcError) { setError(rpcError.message); setSubmitting(false); return }
      if (!data?.success) {
        setError(data?.message || 'Could not block this slot.')
        setSubmitting(false)
        return
      }
      setDone(true)
      setSubmitting(false)
    } catch (e: any) {
      setError(e?.message ?? 'Could not block this slot.')
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose}/>
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-black text-slate-800">🚫 Block Slot</h2>
            <p className="text-xs text-slate-400 mt-0.5">Hold a worker's time without a real booking</p>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-xl flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all">✕</button>
        </div>

        {done ? (
          <div className="px-6 py-6 space-y-4">
            <div className="rounded-2xl p-5 text-center bg-green-50 border border-green-200">
              <p className="text-3xl mb-2">✅</p>
              <p className="font-black text-slate-800">Slot blocked</p>
              <p className="text-xs text-slate-500 mt-1">
                This worker will now show as unavailable for that window.
              </p>
            </div>
            <button onClick={onDone}
              className="w-full h-11 rounded-xl font-black text-sm text-white active:scale-[0.98] transition-all"
              style={{ background: 'linear-gradient(135deg,#DC2626,#B91C1C)' }}>
              Done
            </button>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Worker</p>
              <select value={workerId} onChange={e => { setWorkerId(e.target.value); setScheduledIso('') }}
                className="w-full px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200">
                <option value="">Select worker…</option>
                {workers.map(w => (
                  <option key={w.id} value={w.id}>{w.name} — {w.phone}</option>
                ))}
              </select>
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Duration (minutes)</p>
              <input type="number" min={15} step={15} value={durationMins}
                onChange={e => { setDurationMins(Math.max(15, Number(e.target.value))); setScheduledIso('') }}
                className="w-full px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Date & Time</p>
              <SlotPicker
                workers={filteredWorkers}
                durationMins={durationMins}
                existingBookings={allBookings}
                value={scheduledIso}
                onChange={setScheduledIso}
                emptyHint="Select a worker above first."
              />
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Reason (optional)</p>
              <input type="text" placeholder="e.g. Negotiating price on call" value={note} onChange={e => setNote(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
            </div>

            <p className="text-[11px] text-slate-400">
              This bypasses normal booking checks and reserves capacity directly — it
              won't notify the worker or a customer, it just keeps this window off the table
              for real bookings.
            </p>

            {error && (
              <div className="rounded-xl px-3 py-2.5 bg-red-50 border border-red-200">
                <p className="text-xs font-bold text-red-600">{error}</p>
              </div>
            )}

            <button onClick={submit} disabled={!canSubmit || submitting}
              className="w-full h-11 rounded-xl font-black text-sm text-white disabled:opacity-40 active:scale-[0.98] transition-all"
              style={{ background: 'linear-gradient(135deg,#DC2626,#B91C1C)' }}>
              {submitting ? '…' : '🚫 Block This Slot'}
            </button>
          </div>
        )}
      </div>
    </>
  )
}

function Drawer({
  b, workers, allBookings, zoneWorkerIds, onClose, onDone, onEditManual
}: {
  b: Booking; workers: Worker[]
  allBookings: { worker_id: string; scheduled_at: string }[]
  zoneWorkerIds: Set<string> | null
  onClose: () => void; onDone: () => void
  onEditManual: () => void
}) {
  const [selW, setSelW] = useState(b.worker_id ?? '')
  const [busy, setBusy] = useState(false)
  const [newDateTime, setNewDateTime] = useState('')
  const [rescheduling, setRescheduling] = useState(false)
  const [rescheduleError, setRescheduleError] = useState<string | null>(null)
  const supabase = createClient()
  const cfg = STATUS[b.status] ?? STATUS.pending
  const durationMins = b.service_duration || 60
  const availableForSlot = workers.filter(w =>
    w.id === b.worker_id ||
    (isWorkerAvailableAt(w, b.scheduled_at, durationMins, allBookings) &&
      (zoneWorkerIds == null || zoneWorkerIds.has(w.id)))
  )
  const canAssign  = ['pending','accepted'].includes(b.status)
  const canStartWork = b.is_manual_booking && b.status === 'accepted' && !!b.worker_id
  const totalSec   = b.work_started_at && b.work_ended_at
    ? elapsed(b.work_started_at, b.work_ended_at) : 0

  const scheduledStr = new Date(b.scheduled_at).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  })

  async function assign() {
    if (!selW) return
    if (zoneWorkerIds != null && !zoneWorkerIds.has(selW)) {
      alert('This worker is not assigned to cover this pincode. Please choose a worker from the dropdown list, or assign them to this pincode first under Workers → Areas.')
      return
    }
    setBusy(true)
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

  async function reschedule() {
    if (!newDateTime) return
    setRescheduling(true)
    setRescheduleError(null)
    try {
      const isoString = new Date(newDateTime).toISOString()
      const { data, error } = await supabase.rpc('admin_reschedule_booking', {
        p_booking_id: b.id,
        p_new_scheduled_at: isoString,
      })
      if (error) {
        setRescheduleError(error.message)
        setRescheduling(false)
        return
      }
      if (!data?.success) {
        const reasonMap: Record<string, string> = {
          not_found: 'Booking not found.',
          cannot_reschedule_status: 'This booking can no longer be rescheduled (work has already started or it is finished/cancelled).',
          no_workers: 'No worker is available at the new time.',
          slot_full: 'The new slot is already full — no free worker at that time.',
        }
        setRescheduleError(reasonMap[data?.reason] ?? (data?.message || 'Could not reschedule.'))
        setRescheduling(false)
        return
      }

      const newTimeStr = new Date(isoString).toLocaleString('en-IN', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      })
      await sendNotification(
        b.customer_id, '📅 Booking Rescheduled',
        `Your ${b.service_name} has been moved to ${newTimeStr}.`,
        { booking_id: b.id, type: 'booking_rescheduled' }
      )
      if (b.worker_id) {
        await sendNotification(
          b.worker_id, '📅 Job Rescheduled',
          `A job has been moved to ${newTimeStr}. Please check your schedule.`,
          { booking_id: b.id, type: 'booking_rescheduled' }
        )
      }

      setRescheduling(false)
      onDone()
    } catch (e: any) {
      setRescheduleError(e?.message ?? 'Could not reschedule.')
      setRescheduling(false)
    }
  }

  async function act(status: string) {
    setBusy(true)
    const now = new Date().toISOString()
    const u: any = { status }
    if (status === 'in_progress') {
      u.work_started_at = now
    }
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
    if (status === 'in_progress') {
      await sendNotification(
        b.customer_id, '⚡ Work Started',
        `Your ${b.service_name} is now in progress.`,
        { booking_id: b.id, type: 'booking_in_progress' }
      )
    }
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
          <div className="flex items-center gap-2">
            {b.is_manual_booking && ['pending','accepted'].includes(b.status) && (
              <button onClick={onEditManual}
                className="px-3 py-2 rounded-xl text-[11px] font-black text-violet-700 bg-violet-50 border border-violet-200 hover:bg-violet-100 transition-all">
                ✏️ Edit
              </button>
            )}
            <button onClick={onClose}
              className="w-9 h-9 rounded-xl flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all">✕</button>
          </div>
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

          {b.status === 'accepted' && b.worker_id && !b.is_manual_booking && <OtpStatusBox b={b}/>}

          {canStartWork && (
            <div className="rounded-2xl p-4 border bg-cyan-50 border-cyan-200">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">📞</span>
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-cyan-700">Phone Booking</p>
                  <p className="text-xs text-slate-500">No customer app to enter an OTP — start the job directly</p>
                </div>
              </div>
              <button onClick={() => act('in_progress')} disabled={busy}
                className="w-full flex items-center gap-3 px-4 py-4 rounded-2xl bg-white border border-cyan-300 hover:bg-cyan-50 transition-all active:scale-[0.98] disabled:opacity-50">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-lg bg-cyan-100 text-cyan-700 flex-shrink-0">
                  {busy ? '…' : '▶️'}
                </div>
                <div className="flex-1 text-left">
                  <p className="font-black text-sm text-cyan-700">Start Work</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Timer starts now · Customer notified 🔔</p>
                </div>
                <span className="text-cyan-400 text-lg">›</span>
              </button>
            </div>
          )}

          {b.status === 'in_progress' && (
            <button onClick={() => {
              if (!window.confirm(
                `Mark "${b.service_name}" for ${b.customer} as complete?\n\n` +
                'This will stop the timer, mark payment as paid, and notify the customer immediately.'
              )) return
              act('completed')
            }} disabled={busy}
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
              {zoneWorkerIds != null && (
                <div className="mb-2 px-3 py-2 rounded-xl bg-cyan-50 border border-cyan-200">
                  <p className="text-[11px] text-cyan-700 font-semibold">
                    📐 This address's pincode has assigned workers — only workers
                    covering this zone are shown below.
                  </p>
                </div>
              )}
              <div className="rounded-2xl p-4 space-y-3 bg-slate-50 border border-slate-200">
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
                    <p className="text-xs text-red-400 mt-1">
                      {zoneWorkerIds != null
                        ? 'No worker assigned to this pincode is free at this time.'
                        : `All workers are busy or off-shift at ${new Date(b.scheduled_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`}
                    </p>
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

          {canAssign && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
                Reschedule
              </p>
              <div className="rounded-2xl p-4 space-y-3 bg-slate-50 border border-slate-200">
                <p className="text-[11px] text-slate-500">
                  Admin-only — the customer cannot change this themselves.
                  The new time is checked for a genuinely free worker before
                  it's accepted, exactly like a normal booking.
                </p>
                <input
                  type="datetime-local"
                  value={newDateTime}
                  onChange={e => { setNewDateTime(e.target.value); setRescheduleError(null) }}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-white border border-slate-200"
                />
                {rescheduleError && (
                  <div className="rounded-xl px-3 py-2 bg-red-50 border border-red-200">
                    <p className="text-xs font-bold text-red-600">{rescheduleError}</p>
                  </div>
                )}
                <button
                  onClick={reschedule}
                  disabled={!newDateTime || rescheduling}
                  className="w-full h-11 rounded-xl font-black text-sm text-white disabled:opacity-40 active:scale-[0.98] transition-all"
                  style={{ background: 'linear-gradient(135deg,#7C3AED,#4F46E5)' }}>
                  {rescheduling ? '…' : '📅 Reschedule + Notify Customer & Worker 🔔'}
                </button>
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
                { label: 'Name',  value: b.customer },
                { label: 'Phone', value: b.customer_phone },
              ].map(r => (
                <div key={r.label} className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">{r.label}</span>
                  <span className="text-sm text-slate-800 font-medium">{r.value}</span>
                </div>
              ))}
              <div className="pt-2 mt-1 border-t border-slate-200">
                <span className="text-xs text-slate-400 block mb-1">Full Address</span>
                <p className="text-sm text-slate-800 font-medium leading-relaxed">
                  {[b.flat_no, b.building].filter(Boolean).join(', ')}
                  {(b.flat_no || b.building) && (b.full_address || b.area) ? ', ' : ''}
                  {b.full_address || b.area}
                  {b.city ? `, ${b.city}` : ''}
                  {b.pincode ? ` - ${b.pincode}` : ''}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <a
                    href={
                      b.latitude && b.longitude
                        ? `https://maps.google.com/?q=${b.latitude},${b.longitude}`
                        : `https://maps.google.com/?q=${encodeURIComponent([b.flat_no, b.building, b.full_address || b.area, b.city, b.pincode].filter(Boolean).join(', '))}`
                    }
                    target="_blank" rel="noopener noreferrer"
                    className="text-[11px] font-bold text-cyan-700 hover:underline flex items-center gap-1"
                  >
                    📍 Open in Maps
                  </a>
                  <button
                    onClick={() => {
                      const full = [b.flat_no, b.building, b.full_address || b.area, b.city, b.pincode]
                        .filter(Boolean).join(', ')
                      navigator.clipboard.writeText(full)
                    }}
                    className="text-[11px] font-bold text-slate-500 hover:text-slate-700 flex items-center gap-1"
                  >
                    🔗 Copy address
                  </button>
                </div>
              </div>
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

async function resolvePincodeWorkerIds(
  supabase: any, pincode: string | null
): Promise<Set<string> | null> {
  if (!pincode || pincode.trim() === '') return null
  try {
    const { data: rows } = await supabase
      .from('worker_pincodes')
      .select('worker_id')
      .eq('pincode', pincode.trim())
    const ids = new Set<string>((rows ?? []).map((r: any) => r.worker_id as string))
    return ids.size === 0 ? null : ids
  } catch {
    return null
  }
}

export default function BookingsDashboard({ scope }: { scope: 'month' | 'all' }) {
  const [bookings,  setBookings]  = useState<Booking[]>([])
  const [workers,   setWorkers]   = useState<Worker[]>([])
  const [services,  setServices]  = useState<ServiceOption[]>([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [profile,   setProfile]   = useState<'all'|'live'|'completed'|'cancelled'>('all')
  const [filter,    setFilter]    = useState('all')
  const [selected,  setSelected]  = useState<Booking | null>(null)
  const [mapFor,    setMapFor]    = useState<Booking | null>(null)
  const [selectedDate, setSelectedDate] = useState<string>('all')
  const [selectedArea, setSelectedArea] = useState<string>('all')
  const [assignMap, setAssignMap] = useState<Record<string,string>>({})
  const [assigning, setAssigning] = useState<string | null>(null)
  const [showPhoneModal, setShowPhoneModal] = useState(false)
  const [showBlockModal, setShowBlockModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [zoneEligible, setZoneEligible] = useState<Record<string, Set<string> | null>>({})
  const [pincodeParentArea, setPincodeParentArea] = useState<Record<string, string>>({})
  const dateInputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  const slimBookings = bookings
    .filter(b => ['pending','accepted','in_progress'].includes(b.status))
    .map(b => ({ worker_id: b.worker_id ?? '', scheduled_at: b.scheduled_at }))

  function stripDirectionalSuffix(name: string): string {
    return name
      .replace(/\s+(north\s*east|north\s*west|south\s*east|south\s*west|north|south|east|west)\s*$/i, '')
      .replace(/[\s-]+(उत्तर[\s-]*पूर्व|उत्तर[\s-]*पश्चिम|दक्षिण[\s-]*पूर्व|दक्षिण[\s-]*पश्चिम|पूर्व|पश्चिम|उत्तर|दक्षिण)\s*$/, '')
      .replace(/[\s-]+(नॉर्थ[\s-]*ईस्ट|नॉर्थ[\s-]*वेस्ट|साउथ[\s-]*ईस्ट|साउथ[\s-]*वेस्ट|ईस्ट|वेस्ट|नॉर्थ|साउथ)\s*$/, '')
      .trim()
  }

  const AREA_NAME_ALIASES: Record<string, string> = {
    'बोरिवली': 'Borivali',
    'दहिसर': 'Dahisar',
    'विले पार्ले': 'Vile Parle',
    'अंधेरी': 'Andheri',
    'मालाड': 'Malad',
    'कांदिवली': 'Kandivali',
    'गोरेगांव': 'Goregaon',
    'जोगेश्वरी': 'Jogeshwari',
    'बांद्रा': 'Bandra',
  }

  function resolveGroupName(b: Booking): string {
    const manualOverride = b.pincode ? pincodeParentArea[b.pincode] : undefined
    if (manualOverride) return manualOverride
    const base = b.area || '—'
    if (base === '—') return base
    const stripped = stripDirectionalSuffix(base) || base
    return AREA_NAME_ALIASES[stripped] ?? stripped
  }

  const load = useCallback(async () => {
    const todayStr = (() => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })()

    let bookingsQuery = supabase.from('bookings').select(
      `id,status,final_amount,base_price,discount_amount,scheduled_at,created_at,
       otp,worker_id,payment_status,special_instructions,work_started_at,work_ended_at,booking_duration_minutes,
       service_duration_minutes,is_manual_booking,
       extra_time_mins,extra_time_price,extra_time_payment_status,
       customer_id,
       services(name,duration_minutes),addresses(area,city,full_address,flat_no,building,pincode,latitude,longitude),
       customer:users!customer_id(full_name,phone),
       worker:users!worker_id(full_name,phone),
       booking_items(service_id,quantity,unit_price,total_price,service_name,services(name))`
    )
    if (scope === 'month') {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      bookingsQuery = bookingsQuery
        .gte('scheduled_at', monthStart.toISOString())
        .lt('scheduled_at', monthEnd.toISOString())
    }
    bookingsQuery = bookingsQuery.order('created_at', { ascending: false })

    const [{ data: bd }, { data: wd }, { data: availData }, { data: activeJobs }, { data: schedDateRows }, { data: areaRows }] =
      await Promise.all([
        bookingsQuery,
        supabase.from('users').select('id,full_name,phone').eq('role','worker').order('full_name'),
        supabase.from('workers').select('user_id,is_available'),
        supabase.from('bookings').select('worker_id').eq('status','in_progress'),
        supabase.from('worker_schedule_dates')
          .select('worker_id,date,enabled,start_time,end_time,breaks')
          .gte('date', todayStr),
        supabase.from('service_areas').select('pincode,area,parent_area').eq('is_active', true),
      ])

    const availMap: Record<string,boolean> = {}
    ;(availData ?? []).forEach((w: any) => { availMap[w.user_id] = w.is_available })

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

    const parentAreaMap: Record<string, string> = {}
    ;(areaRows ?? []).forEach((a: any) => {
      if (!a.pincode) return
      const manual = a.parent_area && String(a.parent_area).trim()
      if (manual) parentAreaMap[a.pincode] = manual
    })
    setPincodeParentArea(parentAreaMap)

    if (bd) setBookings(bd.map((b: any) => {
      const items = (b.booking_items ?? []) as any[]
      const servicesList: BookedService[] = items.length > 0
        ? items.map((it: any) => ({
            serviceId: it.service_id ?? null,
            name: it.service_name ?? it.services?.name ?? 'Service',
            qty: it.quantity ?? 1,
            unit_price: it.unit_price ?? 0,
          }))
        : [{
            serviceId: null,
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
        is_manual_booking: b.is_manual_booking === true,
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
        full_address: b.addresses?.full_address ?? '',
        flat_no: b.addresses?.flat_no ?? '',
        building: b.addresses?.building ?? '',
        pincode: b.addresses?.pincode ?? '',
        latitude: b.addresses?.latitude ?? null,
        longitude: b.addresses?.longitude ?? null,
      }
    }))

    const needsAssignBookings = (bd ?? []).filter((b: any) =>
      ['pending', 'accepted'].includes(b.status)
    )
    const zoneEntries = await Promise.all(
      needsAssignBookings.map(async (b: any) => {
        const ids = await resolvePincodeWorkerIds(
          supabase,
          b.addresses?.pincode ?? null
        )
        return [b.id as string, ids] as const
      })
    )
    setZoneEligible(Object.fromEntries(zoneEntries))

    if (wd) setWorkers(wd.map((w: any) => ({
      id: w.id, name: w.full_name ?? 'Unknown', phone: w.phone ?? '',
      is_available: availMap[w.id] !== undefined ? availMap[w.id] : true,
      is_busy: busySet.has(w.id),
      scheduleDates: scheduleDatesMap[w.id] ?? null,
      hasAnyScheduleDates: !!scheduleDatesMap[w.id],
    })))

    setLoading(false)
  }, [scope])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    supabase.from('services').select('id,name,duration_minutes,base_price').order('name')
      .then(({ data }) => {
        if (data) setServices(data.map((s: any) => ({
          id: s.id, name: s.name, duration_minutes: s.duration_minutes ?? 60,
          base_price: s.base_price ?? null,
        })))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const ch = supabase.channel('bkng')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        load()
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const todayLabel = new Date().toLocaleDateString('en-IN',
    { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
  const tomorrowLabel = new Date(Date.now() + 86400000).toLocaleDateString('en-IN',
    { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
  const dayAfterLabel = new Date(Date.now() + 2 * 86400000).toLocaleDateString('en-IN',
    { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

  const isCustomDate = selectedDate !== 'all' && selectedDate !== todayLabel && selectedDate !== tomorrowLabel && selectedDate !== dayAfterLabel

  function countForDate(dateLabel: string) {
    return filtered.filter(b =>
      new Date(b.scheduled_at).toLocaleDateString('en-IN',
        { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) === dateLabel
    ).length
  }

  const allAreas = Array.from(new Set(filtered.map(b => resolveGroupName(b)).filter(a => a && a !== '—'))).sort()

  const dateAreaFiltered = filtered.filter(b => {
    const dateStr = new Date(b.scheduled_at).toLocaleDateString('en-IN',
      { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
    const matchDate = selectedDate === 'all' || dateStr === selectedDate
    const matchArea = selectedArea === 'all' || resolveGroupName(b) === selectedArea
    return matchDate && matchArea
  })

  const groupedByArea: Record<string, typeof filtered> = {}
  dateAreaFiltered.forEach(b => {
    const group = resolveGroupName(b)
    if (!groupedByArea[group]) groupedByArea[group] = []
    groupedByArea[group].push(b)
  })
  Object.keys(groupedByArea).forEach(group => {
    groupedByArea[group] = [...groupedByArea[group]].sort(
      (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
    )
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
            <h1 className="text-2xl font-black text-slate-900 leading-tight tracking-tight">
              Bookings {scope === 'month' ? '— This Month' : '— All Time'}
            </h1>
            <p className="text-xs text-slate-400 font-medium">{bookings.length} total · {inProgressNow} working now</p>
            <div className="flex gap-1.5 mt-1.5">
              <a href="/admin-bookings-monthly"
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                  scope === 'month' ? 'bg-cyan-600 text-white' : 'bg-white text-slate-500 border border-slate-200'
                }`}>
                This Month
              </a>
              <a href="/admin-bookings"
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                  scope === 'all' ? 'bg-cyan-600 text-white' : 'bg-white text-slate-500 border border-slate-200'
                }`}>
                All Time
              </a>
            </div>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
          <div className="flex items-center gap-2">
            <button onClick={() => setShowPhoneModal(true)}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-black text-white active:scale-[0.98] transition-all whitespace-nowrap"
              style={{ background: 'linear-gradient(135deg,#0891B2,#4F46E5)', boxShadow: '0 4px 12px rgba(8,145,178,0.25)' }}>
              📞 Phone Booking
            </button>
            <button onClick={() => setShowBlockModal(true)}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-black text-white active:scale-[0.98] transition-all whitespace-nowrap"
              style={{ background: 'linear-gradient(135deg,#DC2626,#B91C1C)', boxShadow: '0 4px 12px rgba(220,38,38,0.25)' }}>
              🚫 Block Slot
            </button>
          </div>
          <input type="text" placeholder="Search service, customer, phone, worker…" value={search} onChange={e => setSearch(e.target.value)}
            className="px-4 py-2.5 rounded-xl text-sm text-slate-800 placeholder-slate-400 outline-none bg-white border border-slate-200 w-full md:w-72"/>
        </div>
      </div>

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

      <div className="mb-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          <button
            onClick={() => { setSelectedDate('all'); setSelectedArea('all') }}
            className="flex-shrink-0 px-4 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap"
            style={{
              background: selectedDate === 'all' ? 'linear-gradient(135deg,#0891B2,#0E7490)' : '#fff',
              color: selectedDate === 'all' ? '#fff' : '#64748B',
              border: `1.5px solid ${selectedDate === 'all' ? '#0891B2' : '#E2E8F0'}`,
              boxShadow: selectedDate === 'all' ? '0 4px 12px rgba(8,145,178,0.3)' : '0 1px 3px rgba(0,0,0,0.04)',
            }}>
            📅 All Dates
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-black"
              style={{ background: selectedDate === 'all' ? 'rgba(255,255,255,0.2)' : '#CFFAFE', color: selectedDate === 'all' ? '#fff' : '#0891B2' }}>
              {filtered.length}
            </span>
          </button>

          <button
            onClick={() => { setSelectedDate(todayLabel); setSelectedArea('all') }}
            className="flex-shrink-0 px-4 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap"
            style={{
              background: selectedDate === todayLabel ? 'linear-gradient(135deg,#0891B2,#0E7490)' : '#fff',
              color: selectedDate === todayLabel ? '#fff' : '#64748B',
              border: `1.5px solid ${selectedDate === todayLabel ? '#0891B2' : '#BAE6FD'}`,
              boxShadow: selectedDate === todayLabel ? '0 4px 12px rgba(8,145,178,0.3)' : '0 1px 3px rgba(0,0,0,0.04)',
            }}>
            🟢 Today
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-black"
              style={{ background: selectedDate === todayLabel ? 'rgba(255,255,255,0.2)' : '#CFFAFE', color: selectedDate === todayLabel ? '#fff' : '#0891B2' }}>
              {countForDate(todayLabel)}
            </span>
          </button>

          <button
            onClick={() => { setSelectedDate(tomorrowLabel); setSelectedArea('all') }}
            className="flex-shrink-0 px-4 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap"
            style={{
              background: selectedDate === tomorrowLabel ? 'linear-gradient(135deg,#0891B2,#0E7490)' : '#fff',
              color: selectedDate === tomorrowLabel ? '#fff' : '#64748B',
              border: `1.5px solid ${selectedDate === tomorrowLabel ? '#0891B2' : '#E2E8F0'}`,
              boxShadow: selectedDate === tomorrowLabel ? '0 4px 12px rgba(8,145,178,0.3)' : '0 1px 3px rgba(0,0,0,0.04)',
            }}>
            🔵 Tomorrow
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-black"
              style={{ background: selectedDate === tomorrowLabel ? 'rgba(255,255,255,0.2)' : '#CFFAFE', color: selectedDate === tomorrowLabel ? '#fff' : '#0891B2' }}>
              {countForDate(tomorrowLabel)}
            </span>
          </button>

          <button
            onClick={() => { setSelectedDate(dayAfterLabel); setSelectedArea('all') }}
            className="flex-shrink-0 px-4 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap"
            style={{
              background: selectedDate === dayAfterLabel ? 'linear-gradient(135deg,#0891B2,#0E7490)' : '#fff',
              color: selectedDate === dayAfterLabel ? '#fff' : '#64748B',
              border: `1.5px solid ${selectedDate === dayAfterLabel ? '#0891B2' : '#E2E8F0'}`,
              boxShadow: selectedDate === dayAfterLabel ? '0 4px 12px rgba(8,145,178,0.3)' : '0 1px 3px rgba(0,0,0,0.04)',
            }}>
            🟣 Day After
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-black"
              style={{ background: selectedDate === dayAfterLabel ? 'rgba(255,255,255,0.2)' : '#CFFAFE', color: selectedDate === dayAfterLabel ? '#fff' : '#0891B2' }}>
              {countForDate(dayAfterLabel)}
            </span>
          </button>

          <div className="relative flex-shrink-0">
            <button
              type="button"
              onClick={() => {
                const el = dateInputRef.current
                if (!el) return
                if (typeof (el as any).showPicker === 'function') (el as any).showPicker()
                else el.focus()
              }}
              title="Pick a specific date"
              className="w-9 h-9 rounded-xl flex items-center justify-center text-sm transition-all"
              style={{
                background: isCustomDate ? 'linear-gradient(135deg,#0891B2,#0E7490)' : '#fff',
                color: isCustomDate ? '#fff' : '#64748B',
                border: `1.5px solid ${isCustomDate ? '#0891B2' : '#E2E8F0'}`,
                boxShadow: isCustomDate ? '0 4px 12px rgba(8,145,178,0.3)' : '0 1px 3px rgba(0,0,0,0.04)',
              }}>
              🗓️
            </button>
            <input
              ref={dateInputRef}
              type="date"
              onChange={e => {
                if (!e.target.value) return
                setSelectedDate(labelFromDateInput(e.target.value))
                setSelectedArea('all')
              }}
              className="absolute inset-0 w-9 h-9 opacity-0 pointer-events-none"
              tabIndex={-1}
            />
          </div>

          {isCustomDate && (
            <button
              onClick={() => { setSelectedDate('all'); setSelectedArea('all') }}
              className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black whitespace-nowrap text-white"
              style={{ background: 'linear-gradient(135deg,#0891B2,#0E7490)', boxShadow: '0 4px 12px rgba(8,145,178,0.3)' }}>
              📅 {selectedDate}
              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black" style={{ background: 'rgba(255,255,255,0.2)' }}>
                {countForDate(selectedDate)}
              </span>
              <span className="ml-0.5">✕</span>
            </button>
          )}
        </div>

        {allAreas.length > 1 && (
          <div className="flex items-center gap-2 overflow-x-auto pt-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex-shrink-0">Area:</span>
            <button
              onClick={() => setSelectedArea('all')}
              className="flex-shrink-0 px-3 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap"
              style={{
                background: selectedArea === 'all' ? '#CFFAFE' : '#fff',
                color: selectedArea === 'all' ? '#0891B2' : '#64748B',
                border: `1px solid ${selectedArea === 'all' ? '#0891B2' : '#E2E8F0'}`,
              }}>
              All Areas ({dateAreaFiltered.length})
            </button>
            {allAreas.map(area => {
              const cnt = filtered.filter(b => {
                const dateStr = new Date(b.scheduled_at).toLocaleDateString('en-IN',
                  { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
                const matchDate = selectedDate === 'all' || dateStr === selectedDate
                return matchDate && resolveGroupName(b) === area
              }).length
              return (
                <button key={area}
                  onClick={() => setSelectedArea(area)}
                  className="flex-shrink-0 px-3 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap"
                  style={{
                    background: selectedArea === area ? '#CFFAFE' : '#fff',
                    color: selectedArea === area ? '#0891B2' : '#64748B',
                    border: `1px solid ${selectedArea === area ? '#0891B2' : '#E2E8F0'}`,
                  }}>
                  📍 {area} ({cnt})
                </button>
              )
            })}
          </div>
        )}
      </div>

      {dateAreaFiltered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center shadow-sm">
          <p className="text-4xl mb-3">
            {profile === 'live' ? '⚡' : profile === 'completed' ? '✅' : profile === 'cancelled' ? '❌' : '📋'}
          </p>
          <p className="text-slate-700 font-bold">No bookings found</p>
          <p className="text-sm text-slate-400 mt-1">
            {selectedDate !== 'all' || selectedArea !== 'all'
              ? <button onClick={() => { setSelectedDate('all'); setSelectedArea('all') }}
                  className="text-cyan-600 font-bold hover:underline">Clear filters</button>
              : 'Try changing the filter'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedByArea).map(([area, areaBookings]) => (
            <div key={area} className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-sm">
              {(() => {
                const liveInArea = areaBookings.filter(b => b.status === 'in_progress').length
                const pendingInArea = areaBookings.filter(b => b.status === 'pending').length
                const areaTotal = areaBookings.reduce((s, b) => s + b.final_amount, 0)
                const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(area)}`
                return (
                  <div className="flex items-center justify-between px-5 py-4 border-b border-cyan-100/50"
                    style={{ background: 'linear-gradient(135deg,#ECFEFF 0%,#F0FDFF 50%,#EFF6FF 100%)' }}>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                        style={{ background: 'linear-gradient(135deg,#0891B2,#0E7490)', boxShadow: '0 4px 10px rgba(8,145,178,0.3)' }}>
                        📍
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-black text-[15px] text-slate-800">{area}</h3>
                          {liveInArea > 0 && (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black bg-cyan-500 text-white animate-pulse">
                              ● {liveInArea} LIVE
                            </span>
                          )}
                          {pendingInArea > 0 && (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-amber-100 text-amber-700 border border-amber-200">
                              ⏳ {pendingInArea} pending
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {areaBookings.length} booking{areaBookings.length > 1 ? 's' : ''} · ₹{areaTotal.toLocaleString('en-IN')} total
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-white text-teal-700 border border-teal-200 hover:bg-teal-50 transition-all shadow-sm"
                        title="Open area in Google Maps">
                        🗺 View Area
                      </a>
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          const shareText = areaBookings.map(b => {
                            const addr = [b.flat_no, b.building, b.full_address || b.area].filter(Boolean).join(', ')
                            const link = b.latitude && b.longitude
                              ? `https://maps.google.com/?q=${b.latitude},${b.longitude}`
                              : `https://maps.google.com/?q=${encodeURIComponent(addr)}`
                            return `• ${b.customer} (${b.service_name}) - ${b.scheduled_at ? new Date(b.scheduled_at).toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit', timeZone:'Asia/Kolkata'}) : ''} → ${link}`
                          }).join('\n')
                          navigator.clipboard.writeText(`📍 ${area} Bookings:\n${shareText}`)
                          alert(`All ${area} booking addresses copied!`)
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-white text-blue-600 border border-blue-200 hover:bg-blue-50 transition-all shadow-sm"
                        title="Copy maps link">
                        🔗 Share
                      </button>
                    </div>
                  </div>
                )
              })()}

              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/50">
                      {['Service / Customer','Schedule','Location','Status','Worker','Amount','Timer','Actions'].map(c => (
                        <th key={c} className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wide whitespace-nowrap">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {areaBookings.map(b => {
                      const cfg         = STATUS[b.status] ?? STATUS.pending
                      const needsW      = !b.worker_id && ['pending','accepted'].includes(b.status)
                      const isLive      = b.status === 'in_progress'
                      const isDone      = b.status === 'completed' && b.work_started_at && b.work_ended_at
                      const isCancelled = b.status === 'cancelled'
                      const totalSec    = isDone ? elapsed(b.work_started_at, b.work_ended_at) : 0
                      const zoneIds     = zoneEligible[b.id] ?? null
                      const slotAvailable = workers.filter(w =>
                        isWorkerAvailableAt(w, b.scheduled_at, b.service_duration || 60, slimBookings) &&
                        (zoneIds == null || zoneIds.has(w.id))
                      )
                      const canQuickStartWork = b.is_manual_booking && b.status === 'accepted' && !!b.worker_id

                      return (
                        <Fragment key={b.id}>
                          <tr
                            className="border-b border-slate-50 hover:bg-slate-50/70 transition-colors cursor-pointer"
                            onClick={() => setSelected(b)}
                            style={{ opacity: isCancelled ? 0.7 : 1 }}>
                            <td className="px-4 py-3.5">
                              <div className="flex items-center gap-2.5">
                                <div className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-base"
                                  style={{ background: cfg.bg, border: `1px solid ${cfg.color}30` }}>
                                  {isLive ? <span className="animate-pulse">{cfg.icon}</span> : cfg.icon}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <p className="font-black text-slate-800 text-[13px] truncate max-w-[160px]">{b.service_name}</p>
                                    {b.services.length > 1 && (
                                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-cyan-50 text-cyan-700 border border-cyan-200 flex-shrink-0">
                                        +{b.services.length - 1} more
                                      </span>
                                    )}
                                                                        {b.is_manual_booking && (
                                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 flex-shrink-0">
                                        📞 Phone
                                      </span>
                                    )}
                                    <RecurringPackageBadge bookingId={b.id} />
                                    {b.extra_time_mins > 0 && (
                                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 flex-shrink-0">
                                        +{b.extra_time_mins}m {b.extra_time_payment_status === 'paid' ? '✓' : '⏳'}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className="text-[11px] font-semibold text-slate-600">{b.customer}</span>
                                    <span className="text-slate-300">·</span>
                                    <a href={`tel:${b.customer_phone}`}
                                      onClick={e => e.stopPropagation()}
                                      className="text-[11px] text-cyan-600 font-bold hover:underline">
                                      {b.customer_phone}
                                    </a>
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                  style={{ background: isLive ? '#0891B2' : b.status === 'completed' ? '#059669' : '#F59E0B' }}/>
                                <p className="text-[13px] text-slate-700 font-bold">
                                  {new Date(b.scheduled_at).toLocaleDateString('en-IN',
                                    { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}
                                </p>
                              </div>
                              <p className="text-[12px] text-cyan-600 font-bold">
                                🕐 {new Date(b.scheduled_at).toLocaleTimeString('en-IN',
                                  { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                              </p>
                            </td>
                            <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center gap-1.5">
                                <div className="min-w-0">
                                  <p className="text-[12px] font-bold text-slate-700 truncate max-w-[130px]" title={[b.flat_no, b.building, b.full_address, b.area].filter(Boolean).join(', ')}>
                                    📍 {b.area}
                                  </p>
                                  {(b.flat_no || b.building) && (
                                    <p className="text-[10px] text-slate-500 truncate max-w-[130px]">
                                      {[b.flat_no, b.building].filter(Boolean).join(', ')}
                                    </p>
                                  )}
                                  {b.city && <p className="text-[10px] text-slate-400 truncate max-w-[130px]">{b.city}{b.pincode ? ` - ${b.pincode}` : ''}</p>}
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <button
                                    onClick={() => setMapFor(b)}
                                    title="View on map"
                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-xs bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100 transition-all hover:scale-105">
                                    🗺
                                  </button>
                                  <a
                                    href={b.latitude && b.longitude
                                      ? `https://maps.google.com/?q=${b.latitude},${b.longitude}`
                                      : `https://maps.google.com/?q=${encodeURIComponent([b.flat_no, b.building, b.full_address || b.area, b.city].filter(Boolean).join(', '))}`}
                                    target="_blank" rel="noopener noreferrer"
                                    onClick={e => e.stopPropagation()}
                                    title="Open exact location in Google Maps"
                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-xs bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-all hover:scale-105">
                                    📌
                                  </a>
                                  <button
                                    onClick={() => {
                                      const parts = [b.flat_no, b.building, b.full_address || b.area, b.city, b.pincode].filter(Boolean)
                                      const fullAddr = parts.join(', ')
                                      const mapsUrl = b.latitude && b.longitude
                                        ? `https://maps.google.com/?q=${b.latitude},${b.longitude}`
                                        : `https://maps.google.com/?q=${encodeURIComponent(fullAddr)}`
                                      const shareText = `${b.customer} - ${b.service_name}\n📍 ${fullAddr}\n🗺 ${mapsUrl}`
                                      if (navigator.share) {
                                        navigator.share({ title: `Cleenzo Booking - ${b.customer}`, text: shareText, url: mapsUrl })
                                      } else {
                                        navigator.clipboard.writeText(shareText)
                                        alert('Address & maps link copied!')
                                      }
                                    }}
                                    title="Share full address"
                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-xs bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 transition-all hover:scale-105">
                                    🔗
                                  </button>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3.5">
                              <span className="text-[11px] font-bold px-2 py-1 rounded-full whitespace-nowrap"
                                style={{ background: cfg.bg, color: cfg.color }}>
                                {cfg.icon} {cfg.label}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              {b.worker !== 'Unassigned'
                                ? <div className="flex items-center gap-1.5">
                                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-black flex-shrink-0"
                                      style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                                      {b.worker[0]?.toUpperCase()}
                                    </div>
                                    <span className="text-[12px] font-semibold text-slate-700">{b.worker.split(' ')[0]}</span>
                                  </div>
                                : <span className="text-[11px] text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">Unassigned</span>}
                            </td>
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <span className={`text-[13px] font-black ${isCancelled ? 'text-red-400 line-through' : 'text-cyan-700'}`}>
                                ₹{b.final_amount.toLocaleString('en-IN')}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              {isLive && b.work_started_at
                                ? <LiveTimer start={b.work_started_at} end={null} color="#0891B2"/>
                                : isDone && totalSec > 0
                                  ? <span className="font-mono font-bold text-[12px] text-green-700">{durShort(totalSec)}</span>
                                  : <span className="text-slate-300 text-xs">—</span>}
                            </td>
                            <td className="px-4 py-3.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center gap-1.5">
                                {canQuickStartWork && (
                                  <button onClick={() => setSelected(b)}
                                    title="Open to start work (phone booking has no customer OTP step)"
                                    className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-cyan-100 text-cyan-700 border border-cyan-200 hover:bg-cyan-200 transition-all">
                                    ▶️ Start
                                  </button>
                                )}
                                {b.status === 'in_progress' && (
                                  <button onClick={() => {
                                    if (!window.confirm(
                                      `Mark "${b.service_name}" for ${b.customer} as complete?\n\n` +
                                      'This will stop the timer, mark payment as paid, and notify the customer immediately.'
                                    )) return
                                    quickAct(b.id,'completed')
                                  }}
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

                          {needsW && (
                            <tr className="border-b border-slate-50 bg-amber-50/40">
                              <td colSpan={8} className="px-4 py-2" onClick={e => e.stopPropagation()}>
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] text-slate-500 font-medium whitespace-nowrap">
                                    {zoneIds != null && '📐 '}
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
            </div>
          ))}
        </div>
      )}

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
          zoneWorkerIds={zoneEligible[selected.id] ?? null}
          onClose={() => setSelected(null)}
          onDone={() => { load(); setSelected(null) }}
          onEditManual={() => setShowEditModal(true)}
        />
      )}

      {showEditModal && selected && (
        <EditManualBookingModal
          booking={selected}
          services={services}
          workers={workers}
          allBookings={slimBookings}
          onClose={() => setShowEditModal(false)}
          onDone={() => { setShowEditModal(false); load(); setSelected(null) }}
        />
      )}

      {showPhoneModal && (
        <PhoneBookingModal
          services={services}
          workers={workers}
          allBookings={slimBookings}
          onClose={() => setShowPhoneModal(false)}
          onDone={() => { setShowPhoneModal(false); load() }}
        />
      )}

      {showBlockModal && (
        <BlockSlotModal
          workers={workers}
          allBookings={slimBookings}
          onClose={() => setShowBlockModal(false)}
          onDone={() => { setShowBlockModal(false); load() }}
        />
      )}
    </div>
  )
}