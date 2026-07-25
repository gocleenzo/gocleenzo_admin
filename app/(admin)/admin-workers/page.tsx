'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type DaySchedule = {
  enabled: boolean
  start: string   // "09:00"
  end: string     // "17:00"
  breaks: { from: string; to: string }[]
}
type WeekSchedule = Record<string, DaySchedule>  // "monday" → DaySchedule

type Worker = {
  id: string; full_name: string; phone: string; email: string
  is_active: boolean; is_available: boolean; is_verified: boolean
  is_busy: boolean; current_service: string | null; work_started_at: string | null
  joined_at: string | null; created_at: string | null
  totalOrders: number; totalRevenue: number; completed: number
  cancelled: number; pending: number; inProgress: number
  recentBookings: RecentJob[]
  serviceBreakdown: ServiceStat[]
  completedList: RecentJob[]
  schedule: WeekSchedule | null
  worker_otp: string | null
  // work hours aggregates
  totalWorkSecs: number
  todayWorkSecs: number
  thisWeekWorkSecs: number
  thisMonthWorkSecs: number
  dailyHours: { date: string; secs: number }[]      // last 30 days
  weeklyHours: { week: string; secs: number }[]     // last 12 weeks
  monthlyHours: { month: string; secs: number }[]   // last 12 months
}

type ServiceStat = {
  name: string; count: number; income: number; secs: number
}

type RecentJob = {
  id: string; service_name: string; area: string; status: string
  final_amount: number; scheduled_at: string
  work_started_at: string | null; work_ended_at: string | null
}

const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
const DAY_SHORT: Record<string,string> = { monday:'Mon', tuesday:'Tue', wednesday:'Wed', thursday:'Thu', friday:'Fri', saturday:'Sat', sunday:'Sun' }
const EMPTY_DAY: DaySchedule = { enabled: false, start: '09:00', end: '17:00', breaks: [] }
const EMPTY_WORKER = { full_name: '', phone: '', email: '', is_available: true, worker_otp: '' }

const DEFAULT_SCHEDULE: WeekSchedule = Object.fromEntries(
  DAYS.map(d => [d, { ...EMPTY_DAY, enabled: !['saturday','sunday'].includes(d) }])
)

function timeToMins(t: string) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function minsToLabel(m: number) {
  const h = Math.floor(m / 60), min = m % 60
  if (h === 0) return `${min}m`
  if (min === 0) return `${h}h`
  return `${h}h ${min}m`
}

function netMins(day: DaySchedule): number {
  if (!day.enabled) return 0
  const total = timeToMins(day.end) - timeToMins(day.start)
  if (total <= 0) return 0
  const breakMins = day.breaks.reduce((s, b) => {
    const bStart = Math.max(timeToMins(b.from), timeToMins(day.start))
    const bEnd   = Math.min(timeToMins(b.to),   timeToMins(day.end))
    return s + Math.max(0, bEnd - bStart)
  }, 0)
  return Math.max(0, total - breakMins)
}

function weeklyNetMins(sched: WeekSchedule | null): number {
  if (!sched) return 0
  return DAYS.reduce((s, d) => s + (sched[d] ? netMins(sched[d]) : 0), 0)
}

// Is worker currently within their shift and not on break?
function isWithinShift(sched: WeekSchedule | null): boolean {
  if (!sched) return true // no schedule = always available
  const now = new Date()
  const dayName = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][now.getDay()]
  const day = sched[dayName]
  if (!day || !day.enabled) return false
  const nowMins = now.getHours() * 60 + now.getMinutes()
  if (nowMins < timeToMins(day.start) || nowMins >= timeToMins(day.end)) return false
  for (const b of day.breaks) {
    if (nowMins >= timeToMins(b.from) && nowMins < timeToMins(b.to)) return false
  }
  return true
}

function dur(s: number) {
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60
  if (h) return `${h}h ${m}m`; if (m) return `${m}m ${sec}s`; return `${sec}s`
}
function elapsed(start: string, end?: string | null) {
  return Math.floor(((end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()) / 1000)
}

// ── Work Hours Helpers ─────────────────────────────────────────
function secsToHrsLabel(s: number) {
  if (!s) return '0h'
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday
  return new Date(d.getFullYear(), d.getMonth(), diff)
}

function isoWeek(d: Date): string {
  const sw = startOfWeek(new Date(d))
  return `${sw.getFullYear()}-W${String(Math.ceil((((sw.getTime() - new Date(sw.getFullYear(),0,1).getTime()) / 86400000) + 1) / 7)).padStart(2,'0')}`
}

function isoMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
}

function weekLabel(w: string): string {
  // "2024-W23" → "Jun W3"
  const [year, wNum] = w.split('-W')
  const jan1 = new Date(Number(year), 0, 1)
  const d = new Date(jan1.getTime() + (Number(wNum) - 1) * 7 * 86400000)
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function monthLabel(m: string): string {
  const [year, month] = m.split('-')
  return new Date(Number(year), Number(month)-1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
}

function buildWorkHours(completedBookings: any[]) {
  const now = new Date()
  const todayStr   = now.toISOString().slice(0, 10)
  const thisWeek   = isoWeek(now)
  const thisMonth  = isoMonth(now)

  let totalWorkSecs = 0, todayWorkSecs = 0, thisWeekWorkSecs = 0, thisMonthWorkSecs = 0
  const dailyMap:   Record<string, number> = {}
  const weeklyMap:  Record<string, number> = {}
  const monthlyMap: Record<string, number> = {}

  for (const b of completedBookings) {
    if (!b.work_started_at || !b.work_ended_at) continue
    const secs = Math.floor((new Date(b.work_ended_at).getTime() - new Date(b.work_started_at).getTime()) / 1000)
    if (secs <= 0) continue
    const d = new Date(b.work_ended_at)
    const dateStr  = d.toISOString().slice(0, 10)
    const weekStr  = isoWeek(d)
    const monthStr = isoMonth(d)

    totalWorkSecs += secs
    dailyMap[dateStr]   = (dailyMap[dateStr]   ?? 0) + secs
    weeklyMap[weekStr]  = (weeklyMap[weekStr]  ?? 0) + secs
    monthlyMap[monthStr]= (monthlyMap[monthStr]?? 0) + secs

    if (dateStr  === todayStr)   todayWorkSecs    += secs
    if (weekStr  === thisWeek)   thisWeekWorkSecs  += secs
    if (monthStr === thisMonth)  thisMonthWorkSecs += secs
  }

  // last 30 days
  const dailyHours = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now); d.setDate(d.getDate() - (29 - i))
    const ds = d.toISOString().slice(0, 10)
    return { date: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), secs: dailyMap[ds] ?? 0 }
  })

  // last 12 weeks
  const weeklyHours = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now); d.setDate(d.getDate() - (11 - i) * 7)
    const ws = isoWeek(d)
    return { week: weekLabel(ws), secs: weeklyMap[ws] ?? 0 }
  })

  // last 12 months
  const monthlyHours = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1)
    const ms = isoMonth(d)
    return { month: monthLabel(ms), secs: monthlyMap[ms] ?? 0 }
  })

  return { totalWorkSecs, todayWorkSecs, thisWeekWorkSecs, thisMonthWorkSecs, dailyHours, weeklyHours, monthlyHours }
}

// ── Work Hours Panel ────────────────────────────────────────────
function WorkHoursPanel({ w }: { w: Worker }) {
  const [view, setView] = useState<'daily'|'weekly'|'monthly'>('weekly')

  const data = view === 'daily' ? w.dailyHours.map(d => ({ label: d.date, secs: d.secs }))
    : view === 'weekly'  ? w.weeklyHours.map(d => ({ label: d.week,  secs: d.secs }))
    : w.monthlyHours.map(d => ({ label: d.month, secs: d.secs }))

  const maxSecs = Math.max(...data.map(d => d.secs), 1)

  const summaryCards = [
    { label: 'Today',      secs: w.todayWorkSecs,    color: '#0891B2', bg: '#ECFEFF' },
    { label: 'This Week',  secs: w.thisWeekWorkSecs,  color: '#7C3AED', bg: '#F5F3FF' },
    { label: 'This Month', secs: w.thisMonthWorkSecs, color: '#059669', bg: '#ECFDF5' },
    { label: 'All Time',   secs: w.totalWorkSecs,     color: '#D97706', bg: '#FFFBEB' },
  ]

  return (
    <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <p className="text-xs font-black text-slate-700">⏱ Work Hours</p>
        <span className="text-xs font-black text-cyan-700">{secsToHrsLabel(w.totalWorkSecs)} total</span>
      </div>
      <div className="p-4 space-y-4">
        {/* summary row */}
        <div className="grid grid-cols-2 gap-2">
          {summaryCards.map(c => (
            <div key={c.label} className="rounded-xl p-3 border" style={{ background: c.bg, borderColor: c.color+'25' }}>
              <p className="text-lg font-black leading-none mb-0.5" style={{ color: c.color }}>{secsToHrsLabel(c.secs)}</p>
              <p className="text-[10px] text-slate-400">{c.label}</p>
            </div>
          ))}
        </div>

        {/* view toggle */}
        <div className="flex gap-1 p-1 rounded-xl bg-slate-100">
          {(['daily','weekly','monthly'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className="flex-1 py-1.5 rounded-lg text-[10px] font-black capitalize transition-all"
              style={{
                background: view === v ? '#fff' : 'transparent',
                color:      view === v ? '#0891B2' : '#94A3B8',
                boxShadow:  view === v ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}>
              {v}
            </button>
          ))}
        </div>

        {/* bar chart */}
        <div className="space-y-1">
          {data.filter((_, i) => {
            // daily: last 14, weekly: last 8, monthly: all 12
            if (view === 'daily')   return i >= data.length - 14
            if (view === 'weekly')  return i >= data.length - 8
            return true
          }).map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <p className="text-[9px] text-slate-400 w-14 text-right flex-shrink-0 truncate">{d.label}</p>
              <div className="flex-1 h-5 rounded-lg bg-slate-100 overflow-hidden relative">
                <div className="h-full rounded-lg transition-all duration-500"
                  style={{
                    width: `${Math.round((d.secs / maxSecs) * 100)}%`,
                    background: d.secs > 0
                      ? 'linear-gradient(90deg,#0891B2,#7C3AED)'
                      : 'transparent',
                    minWidth: d.secs > 0 ? '4px' : '0',
                  }}/>
                {d.secs > 0 && (
                  <span className="absolute right-1 top-0 bottom-0 flex items-center text-[9px] font-black text-white mix-blend-multiply">
                    {secsToHrsLabel(d.secs)}
                  </span>
                )}
              </div>
            </div>
          ))}
          {data.every(d => d.secs === 0) && (
            <p className="text-center text-xs text-slate-400 py-3">No work hours recorded yet</p>
          )}
        </div>
      </div>
    </div>
  )
}

function LiveTimer({ start, color = '#D97706' }: { start: string; color?: string }) {
  const [t, setT] = useState(elapsed(start))
  useEffect(() => {
    setT(elapsed(start))
    const i = setInterval(() => setT(elapsed(start)), 1000)
    return () => clearInterval(i)
  }, [start])
  return (
    <span className="font-mono font-black text-xs flex items-center gap-1" style={{ color }}>
      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: color }}/>
      {dur(t)}
    </span>
  )
}

const JOB_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending:      { label: 'Pending',     color: '#D97706', bg: '#FEF3C7' },
  accepted:     { label: 'Assigned',    color: '#2563EB', bg: '#DBEAFE' },
  otp_verified: { label: 'OTP OK',      color: '#7C3AED', bg: '#EDE9FE' },
  in_progress:  { label: 'In Progress', color: '#0891B2', bg: '#CFFAFE' },
  completed:    { label: 'Done',        color: '#059669', bg: '#D1FAE5' },
  cancelled:    { label: 'Cancelled',   color: '#DC2626', bg: '#FEE2E2' },
}

// ── Approval Tab (onboarding review) ────────────────────────────
function ApprovalTab({ workerId, onChanged }: { workerId: string; onChanged: () => void }) {
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/worker-approval?worker_id=${workerId}`, { cache: 'no-store' })
      setD(await res.json())
    } catch { setD(null) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [workerId])

  async function act(action: string, reason?: string) {
    setBusy(true)
    try {
      await fetch('/api/worker-approval', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: workerId, action, reason }),
      })
      await load()
      onChanged()
    } finally { setBusy(false) }
  }

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Loading…</div>
  if (!d) return <div className="p-8 text-center text-slate-400 text-sm">No response from server.</div>
  if (d.error) return (
    <div className="p-6">
      <div className="rounded-xl bg-red-50 border border-red-100 p-4 text-sm text-red-700">
        <p className="font-bold mb-1">Could not load onboarding data</p>
        <p className="text-[13px]">{String(d.error)}</p>
      </div>
    </div>
  )

  const STATUS: Record<string, { bg: string; fg: string; label: string }> = {
    onboarding: { bg: '#f1f5f9', fg: '#64748b', label: 'Onboarding (not submitted)' },
    pending:    { bg: '#fef3c7', fg: '#b45309', label: 'Pending review' },
    approved:   { bg: '#dcfce7', fg: '#15803d', label: 'Approved' },
    rejected:   { bg: '#fee2e2', fg: '#b91c1c', label: 'Rejected' },
  }
  const st = STATUS[d.status] ?? STATUS.onboarding
  const p = d.profile ?? {}
  const b = d.bank ?? {}

  return (
    <div className="p-5 space-y-4">
      {/* status banner */}
      <div className="flex items-center justify-between rounded-xl px-4 py-3 border"
        style={{ background: st.bg + '77', borderColor: st.fg + '30' }}>
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Onboarding status</p>
          <p className="text-sm font-black" style={{ color: st.fg }}>{st.label}</p>
        </div>
        {d.submitted_at && (
          <p className="text-[11px] text-slate-400">
            Submitted {new Date(d.submitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </p>
        )}
      </div>

      {d.reason && d.status === 'rejected' && (
        <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-sm text-red-700">
          <span className="font-bold">Rejection reason: </span>{d.reason}
        </div>
      )}

      {/* personal */}
      <ApSection title="Personal details">
        <ApField label="Full name" value={p.full_name || '—'} />
        <ApField label="Phone" value={p.phone || '—'} />
        <ApField label="Email" value={p.email || '—'} />
        <ApField label="Gender" value={p.gender || '—'} />
        <ApField label="Date of birth" value={p.date_of_birth || '—'} />
        <ApField label="Marital status" value={p.marital_status || '—'} />
        <ApField label="Address" value={p.address || '—'} />
      </ApSection>

      {/* emergency */}
      <ApSection title="Emergency contact">
        <ApField label="Name" value={p.emergency_name || '—'} />
        <ApField label="Phone" value={p.emergency_phone || '—'} />
        <ApField label="Relationship" value={p.emergency_relation || '—'} />
      </ApSection>

      {/* work */}
      <ApSection title="Work preferences">
        <ApField label="Available hours/day" value={p.available_hours != null ? String(p.available_hours) + ' hrs' : '—'} />
        <ApField label="Base area" value={p.base_address || '—'} />
        <ApField label="Other areas" value={p.work_areas_note || '—'} />
      </ApSection>

      {/* documents */}
      <div>
        <p className="text-[11px] font-black uppercase tracking-wide text-slate-400 mb-2">Documents</p>
        <div className="grid grid-cols-2 gap-2.5">
          {([['photo','Photograph'],['pan','PAN card'],['aadhaar_front','Aadhaar front'],['aadhaar_back','Aadhaar back'],['signature','Signature']] as [string,string][]).map(([key,label]) => (
            <div key={key} className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="h-28 bg-slate-100 flex items-center justify-center">
                {d.urls?.[key] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.urls[key]} alt={label} className="w-full h-full object-cover cursor-zoom-in"
                    onClick={() => setZoom(d.urls[key])} />
                ) : (
                  <span className="text-[11px] text-slate-400">Not uploaded</span>
                )}
              </div>
              <p className="text-[11px] font-bold text-slate-600 px-2 py-1.5">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* bank + verify toggle */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">Bank details</p>
          <button disabled={busy}
            onClick={() => act(d.bank_verified ? 'bank_unverify' : 'bank_verify')}
            className="text-[11px] font-black px-3 py-1.5 rounded-lg border transition-all disabled:opacity-50"
            style={{
              background: d.bank_verified ? '#dcfce7' : '#fff',
              color: d.bank_verified ? '#15803d' : '#0891B2',
              borderColor: d.bank_verified ? '#86efac' : '#cbd5e1',
            }}>
            {d.bank_verified ? '✓ Bank verified' : 'Mark bank verified'}
          </button>
        </div>
        <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
          <ApField label="Holder" value={b.holder || '—'} mono />
          <ApField label="Account no." value={b.account || '—'} mono />
          <ApField label="IFSC" value={b.ifsc || '—'} mono />
          <ApField label="UPI" value={b.upi || '—'} mono />
          <ApField label="PAN" value={b.pan || '—'} mono />
          <ApField label="Aadhaar" value={b.aadhaar || '—'} mono />
        </div>
        <p className="text-[11px] text-slate-400 mt-2">
          Tip: cross-check documents in the KYC tab. Bank verification via DigiLocker / penny-drop can be wired here later.
        </p>
      </div>

      {/* approve / reject */}
      <div className="flex gap-3 pt-1">
        <button disabled={busy || d.status === 'rejected'}
          onClick={() => { const r = window.prompt('Reason for rejection (worker will see this):'); if (r !== null) act('reject', r) }}
          className="flex-1 py-3 rounded-xl font-bold text-white disabled:opacity-40" style={{ background: '#dc2626' }}>
          {busy ? '…' : 'Reject'}
        </button>
        <button disabled={busy || d.status === 'approved'}
          onClick={() => act('approve')}
          className="flex-1 py-3 rounded-xl font-bold text-white disabled:opacity-40" style={{ background: '#16a34a' }}>
          {d.status === 'approved' ? 'Approved ✓' : busy ? '…' : 'Approve worker'}
        </button>
      </div>
      {zoom && (
        <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4" onClick={() => setZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="doc" className="max-w-full max-h-full rounded-xl" />
        </div>
      )}
    </div>
  )
}

function ApSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-black uppercase tracking-wide text-slate-400 mb-2">{title}</p>
      <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">{children}</div>
    </div>
  )
}

function ApField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 gap-3">
      <span className="text-[13px] text-slate-500 capitalize flex-shrink-0">{label}</span>
      <span className={`text-[13px] font-bold text-slate-800 text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

// ── KYC Tab (inside worker detail) ──────────────────────────────
function KycTab({ workerId }: { workerId: string }) {
  const [detail, setDetail] = useState<any>(null)
  const [urls, setUrls] = useState<Record<string, string | null>>({})
  const [consents, setConsents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/kyc?worker_id=${workerId}`, { cache: 'no-store' })
      const json = await res.json()
      setDetail(json.kyc)
      setUrls(json.urls ?? {})
      setConsents(json.consents ?? [])
    } catch { setDetail(null) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [workerId])

  async function act(action: 'verify' | 'reject') {
    let reason: string | null = null
    if (action === 'reject') reason = window.prompt('Reason for rejection:') || null
    setBusy(true)
    try {
      await fetch('/api/kyc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: workerId, action, reason }),
      })
      await load()
    } finally { setBusy(false) }
  }

  const KYC_STATUS: Record<string, { bg: string; fg: string; label: string }> = {
    incomplete: { bg: '#f1f5f9', fg: '#64748b', label: 'Incomplete' },
    submitted:  { bg: '#fef3c7', fg: '#b45309', label: 'Submitted' },
    verified:   { bg: '#dcfce7', fg: '#15803d', label: 'Verified' },
    rejected:   { bg: '#fee2e2', fg: '#b91c1c', label: 'Rejected' },
  }

  const docs: [string, string][] = [
    ['photo', 'Photograph'],
    ['pan', 'PAN card'],
    ['aadhaar_front', 'Aadhaar front'],
    ['aadhaar_back', 'Aadhaar back'],
    ['signature', 'Signature'],
  ]

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Loading KYC…</div>

  if (!detail) return (
    <div className="p-8 text-center">
      <p className="text-3xl mb-2">🪪</p>
      <p className="text-slate-600 font-bold text-sm">No KYC submitted yet</p>
      <p className="text-[11px] text-slate-400 mt-1">This worker hasn&apos;t started verification.</p>
    </div>
  )

  const st = KYC_STATUS[detail.status] ?? KYC_STATUS.incomplete

  return (
    <div className="p-5 space-y-4">
      {/* status banner */}
      <div className="flex items-center justify-between rounded-xl px-4 py-3 border"
        style={{ background: st.bg + '55', borderColor: st.fg + '30' }}>
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Verification status</p>
          <p className="text-sm font-black" style={{ color: st.fg }}>{st.label}</p>
        </div>
        {detail.submitted_at && (
          <p className="text-[11px] text-slate-400">
            Submitted {new Date(detail.submitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </p>
        )}
      </div>

      {/* bank */}
      <KycSection title="Bank & payout">
        <KycField label="Holder" value={detail.bank_holder || '—'} />
        <KycField label="Account no." value={detail.bank_account || '—'} mono />
        <KycField label="IFSC" value={detail.bank_ifsc || '—'} mono />
        <KycField label="UPI ID" value={detail.upi_id || '—'} mono />
      </KycSection>

      {/* identity */}
      <KycSection title="Identity">
        <KycField label="PAN" value={detail.pan_number || '—'} mono />
        <KycField label="Aadhaar" value={detail.aadhaar_number || '—'} mono />
      </KycSection>

      {/* personal */}
      <KycSection title="Personal">
        <KycField label="Date of birth" value={detail.date_of_birth || '—'} />
        <KycField label="Marital status" value={detail.marital_status || '—'} />
        <KycField label="Number of kids" value={detail.number_of_kids || '—'} />
        <KycField label="Languages" value={(detail.languages && detail.languages.length) ? detail.languages.join(', ') : '—'} />
      </KycSection>

      {/* documents */}
      <div>
        <p className="text-[11px] font-black uppercase tracking-wide text-slate-400 mb-2">Documents</p>
        <div className="grid grid-cols-2 gap-2.5">
          {docs.map(([key, label]) => (
            <div key={key} className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="h-28 bg-slate-100 flex items-center justify-center">
                {urls[key] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urls[key]!} alt={label} className="w-full h-full object-cover cursor-zoom-in"
                    onClick={() => setZoom(urls[key]!)} />
                ) : (
                  <span className="text-[11px] text-slate-400">Not uploaded</span>
                )}
              </div>
              <p className="text-[11px] font-bold text-slate-600 px-2 py-1.5">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* consents */}
      <KycSection title="Legal consent">
        {consents.length === 0 ? (
          <div className="px-3 py-2.5"><span className="text-[13px] text-slate-400">No consent records.</span></div>
        ) : (
          consents.map((c: any, i: number) => (
            <KycField key={i} label={c.doc_type}
              value={`${c.doc_version} · ${new Date(c.accepted_at).toLocaleDateString('en-IN')}`} />
          ))
        )}
      </KycSection>

      {detail.reject_reason && (
        <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-sm text-red-700">
          Rejected: {detail.reject_reason}
        </div>
      )}

      {/* actions */}
      <div className="flex gap-3 pt-1">
        <button disabled={busy || detail.status === 'rejected'} onClick={() => act('reject')}
          className="flex-1 py-3 rounded-xl font-bold text-white disabled:opacity-40" style={{ background: '#dc2626' }}>
          {busy ? '…' : 'Reject'}
        </button>
        <button disabled={busy || detail.status === 'verified'} onClick={() => act('verify')}
          className="flex-1 py-3 rounded-xl font-bold text-white disabled:opacity-40" style={{ background: '#16a34a' }}>
          {detail.status === 'verified' ? 'Verified ✓' : busy ? '…' : 'Verify worker'}
        </button>
      </div>

      {zoom && (
        <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4" onClick={() => setZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="doc" className="max-w-full max-h-full rounded-xl" />
        </div>
      )}
    </div>
  )
}

function KycSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-black uppercase tracking-wide text-slate-400 mb-2">{title}</p>
      <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">{children}</div>
    </div>
  )
}

function KycField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <span className="text-[13px] text-slate-500 capitalize">{label}</span>
      <span className={`text-[13px] font-bold text-slate-800 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

// ── Schedule Editor ─────────────────────────────────────────────
function ScheduleEditor({ schedule, onChange }: { schedule: WeekSchedule; onChange: (s: WeekSchedule) => void }) {
  function updateDay(day: string, patch: Partial<DaySchedule>) {
    onChange({ ...schedule, [day]: { ...schedule[day], ...patch } })
  }
  function addBreak(day: string) {
    const d = schedule[day]
    onChange({ ...schedule, [day]: { ...d, breaks: [...d.breaks, { from: '13:00', to: '14:00' }] } })
  }
  function removeBreak(day: string, idx: number) {
    const d = schedule[day]
    onChange({ ...schedule, [day]: { ...d, breaks: d.breaks.filter((_,i) => i !== idx) } })
  }
  function updateBreak(day: string, idx: number, field: 'from'|'to', val: string) {
    const d = schedule[day]
    const breaks = d.breaks.map((b, i) => i === idx ? { ...b, [field]: val } : b)
    onChange({ ...schedule, [day]: { ...d, breaks } })
  }

  return (
    <div className="space-y-2">
      {DAYS.map(day => {
        const d = schedule[day] ?? EMPTY_DAY
        const net = netMins(d)
        return (
          <div key={day} className="rounded-2xl border overflow-hidden transition-all"
            style={{ borderColor: d.enabled ? '#BAE6FD' : '#F1F5F9', background: d.enabled ? '#F0F9FF' : '#F8FAFC' }}>
            {/* day header row */}
            <div className="flex items-center gap-3 px-4 py-3">
              <button onClick={() => updateDay(day, { enabled: !d.enabled })}
                className="w-10 h-6 rounded-full relative flex-shrink-0 transition-all"
                style={{ background: d.enabled ? '#0891B2' : '#CBD5E1' }}>
                <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all"
                  style={{ left: d.enabled ? '18px' : '2px' }}/>
              </button>
              <p className="text-sm font-black text-slate-700 w-10">{DAY_SHORT[day]}</p>

              {d.enabled ? (
                <>
                  <input type="time" value={d.start} onChange={e => updateDay(day, { start: e.target.value })}
                    className="px-2 py-1.5 rounded-lg text-xs font-bold text-slate-700 bg-white border border-slate-200 outline-none"/>
                  <span className="text-slate-400 text-xs">to</span>
                  <input type="time" value={d.end} onChange={e => updateDay(day, { end: e.target.value })}
                    className="px-2 py-1.5 rounded-lg text-xs font-bold text-slate-700 bg-white border border-slate-200 outline-none"/>
                  <div className="flex-1"/>
                  <span className="text-[10px] font-black text-cyan-700 bg-cyan-100 px-2 py-1 rounded-lg whitespace-nowrap">
                    {minsToLabel(net)} net
                  </span>
                  <button onClick={() => addBreak(day)}
                    className="text-[10px] font-black px-2 py-1 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 transition-all whitespace-nowrap">
                    + Break
                  </button>
                </>
              ) : (
                <span className="text-xs text-slate-400">Day off</span>
              )}
            </div>

            {/* breaks */}
            {d.enabled && d.breaks.length > 0 && (
              <div className="px-4 pb-3 space-y-1.5">
                {d.breaks.map((b, i) => (
                  <div key={i} className="flex items-center gap-2 ml-13">
                    <div className="w-1 h-1 rounded-full bg-amber-400 ml-11"/>
                    <span className="text-[10px] text-amber-700 font-bold">Break:</span>
                    <input type="time" value={b.from} onChange={e => updateBreak(day, i, 'from', e.target.value)}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold text-slate-600 bg-white border border-amber-200 outline-none"/>
                    <span className="text-[10px] text-slate-400">–</span>
                    <input type="time" value={b.to} onChange={e => updateBreak(day, i, 'to', e.target.value)}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold text-slate-600 bg-white border border-amber-200 outline-none"/>
                    <span className="text-[10px] text-amber-600">
                      -{minsToLabel(Math.max(0, timeToMins(b.to) - timeToMins(b.from)))}
                    </span>
                    <button onClick={() => removeBreak(day, i)}
                      className="w-5 h-5 rounded-full bg-red-100 text-red-500 text-[10px] flex items-center justify-center hover:bg-red-200 transition-all ml-auto">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Schedule Summary ────────────────────────────────────────────
function ScheduleSummary({ schedule }: { schedule: WeekSchedule | null }) {
  if (!schedule) return (
    <div className="rounded-xl px-3 py-2 bg-slate-50 border border-slate-200 text-center">
      <p className="text-xs text-slate-400">No schedule set</p>
    </div>
  )
  const weekMins = weeklyNetMins(schedule)
  const now = new Date()
  const todayName = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][now.getDay()]
  const todayDay  = schedule[todayName]
  const withinShift = isWithinShift(schedule)

  return (
    <div className="space-y-2">
      {/* today status */}
      <div className="rounded-xl px-3 py-2.5 flex items-center justify-between border"
        style={{ background: withinShift ? '#ECFDF5' : '#FFF7ED', borderColor: withinShift ? '#6EE7B7' : '#FED7AA' }}>
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider" style={{ color: withinShift ? '#059669' : '#D97706' }}>
            Today ({DAY_SHORT[todayName]})
          </p>
          {todayDay?.enabled
            ? <p className="text-xs font-bold text-slate-700">{todayDay.start} – {todayDay.end} · {minsToLabel(netMins(todayDay))} net</p>
            : <p className="text-xs text-slate-400">Day off</p>
          }
        </div>
        <span className="text-xs font-black px-2 py-1 rounded-lg"
          style={{ background: withinShift ? '#D1FAE5' : '#FEF3C7', color: withinShift ? '#059669' : '#D97706' }}>
          {withinShift ? '✓ In Shift' : '✕ Off Shift'}
        </span>
      </div>

      {/* weekly grid */}
      <div className="grid grid-cols-7 gap-1">
        {DAYS.map(d => {
          const day = schedule[d]
          const net = day ? netMins(day) : 0
          const isToday = d === todayName
          return (
            <div key={d} className="rounded-xl p-1.5 text-center border"
              style={{
                background: !day?.enabled ? '#F8FAFC' : net > 0 ? '#ECFEFF' : '#FEF3C7',
                borderColor: isToday ? '#0891B2' : !day?.enabled ? '#F1F5F9' : '#BAE6FD',
                boxShadow: isToday ? '0 0 0 2px #0891B280' : 'none',
              }}>
              <p className="text-[8px] font-black text-slate-400">{DAY_SHORT[d].slice(0,2)}</p>
              <p className="text-[10px] font-black mt-0.5" style={{ color: !day?.enabled ? '#CBD5E1' : '#0891B2' }}>
                {!day?.enabled ? '–' : minsToLabel(net)}
              </p>
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between px-1">
        <p className="text-[10px] text-slate-400">Weekly net hours</p>
        <p className="text-xs font-black text-cyan-700">{minsToLabel(weekMins)}</p>
      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════
// UNIFIED WORKER TABS: Payouts, Earnings, Referrals, Tier, SOS
// Each fetches only this worker's data via ?worker_id= filter.
// ═══════════════════════════════════════════════════════════════

function money(n: number) { return '₹' + (n ?? 0).toLocaleString('en-IN') }
function fmtDate(d?: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
}

const PAYOUT_ST: Record<string, { bg: string; fg: string; label: string }> = {
  requested:  { bg: '#fef3c7', fg: '#b45309', label: 'Requested' },
  approved:   { bg: '#dbeafe', fg: '#1d4ed8', label: 'Approved' },
  processing: { bg: '#ede9fe', fg: '#6d28d9', label: 'Processing' },
  paid:       { bg: '#dcfce7', fg: '#15803d', label: 'Paid' },
  rejected:   { bg: '#fee2e2', fg: '#b91c1c', label: 'Rejected' },
}

// ── Payouts tab (actionable) ────────────────────────────────────
function PayoutsTab({ workerId }: { workerId: string }) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/payroll/payouts?status=all&worker_id=${workerId}`, { cache: 'no-store' })
      const j = await res.json()
      setRows(j.requests ?? [])
    } catch { setRows([]) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [workerId])

  async function act(id: string, action: string) {
    let reason: string | undefined
    if (action === 'reject') { const r = window.prompt('Reason for rejection:'); if (r === null) return; reason = r }
    setBusy(id)
    try {
      await fetch('/api/payroll/payouts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, reason }),
      })
      await load()
    } finally { setBusy(null) }
  }

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Loading payouts…</div>
  if (rows.length === 0) return (
    <div className="p-8 text-center">
      <p className="text-3xl mb-2">💸</p>
      <p className="text-slate-600 font-bold text-sm">No payout requests</p>
    </div>
  )

  return (
    <div className="p-5 space-y-3">
      {rows.map(r => {
        const st = PAYOUT_ST[r.status] ?? PAYOUT_ST.requested
        return (
          <div key={r.id} className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
              <div>
                <p className="text-sm font-black text-slate-800">{money(r.amount)}</p>
                <p className="text-[11px] text-slate-400">{fmtDate(r.from)} – {fmtDate(r.to)}</p>
              </div>
              <span className="text-[11px] font-black px-2.5 py-1 rounded-full"
                style={{ background: st.bg, color: st.fg }}>{st.label}</span>
            </div>
            <div className="px-4 py-3 grid grid-cols-3 gap-2 text-center">
              <div><p className="text-[10px] text-slate-400 uppercase">Base</p><p className="text-xs font-bold text-slate-700">{money(r.base)}</p></div>
              <div><p className="text-[10px] text-slate-400 uppercase">Order</p><p className="text-xs font-bold text-slate-700">{money(r.order)}</p></div>
              <div><p className="text-[10px] text-slate-400 uppercase">Travel</p><p className="text-xs font-bold text-slate-700">{money(r.travel)}</p></div>
            </div>
            {r.reject_reason && (
              <div className="px-4 pb-2"><p className="text-[11px] text-red-600">Rejected: {r.reject_reason}</p></div>
            )}
            {(r.status === 'requested' || r.status === 'approved' || r.status === 'processing') && (
              <div className="flex gap-2 px-4 pb-3">
                {r.status === 'requested' && (
                  <button disabled={busy === r.id} onClick={() => act(r.id, 'approve')}
                    className="flex-1 py-2 rounded-lg text-xs font-black text-white disabled:opacity-40" style={{ background: '#0891B2' }}>Approve</button>
                )}
                {r.status === 'approved' && (
                  <button disabled={busy === r.id} onClick={() => act(r.id, 'processing')}
                    className="flex-1 py-2 rounded-lg text-xs font-black text-white disabled:opacity-40" style={{ background: '#6d28d9' }}>Mark processing</button>
                )}
                {r.status === 'processing' && (
                  <button disabled={busy === r.id} onClick={() => act(r.id, 'paid')}
                    className="flex-1 py-2 rounded-lg text-xs font-black text-white disabled:opacity-40" style={{ background: '#15803d' }}>Mark paid</button>
                )}
                {r.status !== 'processing' && (
                  <button disabled={busy === r.id} onClick={() => act(r.id, 'reject')}
                    className="flex-1 py-2 rounded-lg text-xs font-black text-white disabled:opacity-40" style={{ background: '#dc2626' }}>Reject</button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Earnings tab (read-only breakdown) ──────────────────────────
function EarningsTab({ workerId }: { workerId: string }) {
  const [m, setM] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      // Pull all four money sources for THIS worker in parallel.
      const [earnRes, claimRes, refRes, tierRes] = await Promise.all([
        fetch(`/api/payroll/earnings?worker_id=${workerId}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null),
        fetch(`/api/payroll/claims?status=all&worker_id=${workerId}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null),
        fetch(`/api/referrals?status=all&worker_id=${workerId}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null),
        fetch(`/api/tiers?status=all&worker_id=${workerId}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null),
      ])

      // Base + Order — lifetime earned from the payroll engine (treated as the
      // earned baseline). Payout requests track what was actually withdrawn.
      const e = earnRes?.earnings ?? earnRes ?? {}
      const baseOrderEarned = Number(e.base ?? 0) + Number(e.order ?? 0)

      // Payout requests give the true paid vs pending on base/order/travel.
      const payRes = await fetch(`/api/payroll/payouts?status=all&worker_id=${workerId}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null)
      const payouts = payRes?.requests ?? []
      let paidBaseOrder = 0, pendBaseOrder = 0, paidTravelPO = 0, pendTravelPO = 0
      for (const p of payouts) {
        const bo = Number(p.base ?? 0) + Number(p.order ?? 0)
        const tv = Number(p.travel ?? 0)
        if (p.status === 'paid') { paidBaseOrder += bo; paidTravelPO += tv }
        else if (p.status !== 'rejected') { pendBaseOrder += bo; pendTravelPO += tv }
      }

      // Travel claims — approved = paid, pending = pending. (Falls back to
      // payout-embedded travel if no separate claims exist.)
      const claims = claimRes?.claims ?? []
      let paidTravel = 0, pendTravel = 0
      for (const c of claims) {
        if (c.status === 'approved') paidTravel += Number(c.amount ?? 0)
        else if (c.status === 'pending') pendTravel += Number(c.amount ?? 0)
      }
      if (paidTravel === 0 && pendTravel === 0) { paidTravel = paidTravelPO; pendTravel = pendTravelPO }

      // Referral rewards — paid vs earned.
      const refs = refRes?.referrals ?? refRes?.rows ?? []
      let paidRef = 0, pendRef = 0
      for (const r of refs) {
        if (r.status === 'paid') paidRef += Number(r.amount ?? 0)
        else if (r.status === 'earned') pendRef += Number(r.amount ?? 0)
      }

      // Tier bonuses — paid vs earned.
      const tiers = tierRes?.rewards ?? tierRes?.rows ?? []
      let paidTier = 0, pendTier = 0
      for (const t of tiers) {
        if (t.status === 'paid') paidTier += Number(t.amount ?? 0)
        else if (t.status === 'earned') pendTier += Number(t.amount ?? 0)
      }

      // If no payout requests exist yet, show earned base/order as pending.
      if (paidBaseOrder === 0 && pendBaseOrder === 0 && baseOrderEarned > 0) {
        pendBaseOrder = baseOrderEarned
      }

      const paid = { baseOrder: paidBaseOrder, travel: paidTravel, referral: paidRef, tier: paidTier }
      const pend = { baseOrder: pendBaseOrder, travel: pendTravel, referral: pendRef, tier: pendTier }
      const paidTotal = paid.baseOrder + paid.travel + paid.referral + paid.tier
      const pendTotal = pend.baseOrder + pend.travel + pend.referral + pend.tier

      setM({ paid, pend, paidTotal, pendTotal, shiftHours: e.shiftHours })
    } catch { setM(null) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [workerId])

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Loading money breakdown…</div>
  if (!m) return <div className="p-8 text-center text-slate-400 text-sm">No earnings data.</div>

  const srcRow = (label: string, paid: number, pend: number, color: string) => (
    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 last:border-0">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full" style={{ background: color }} />
        <span className="text-[13px] font-bold text-slate-700">{label}</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-[9px] text-slate-400 uppercase">Paid</p>
          <p className="text-[13px] font-black text-green-600">{money(paid)}</p>
        </div>
        <div className="text-right">
          <p className="text-[9px] text-slate-400 uppercase">Pending</p>
          <p className="text-[13px] font-black text-amber-600">{money(pend)}</p>
        </div>
      </div>
    </div>
  )

  return (
    <div className="p-5 space-y-4">
      {/* Two headline totals */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl p-4 text-center" style={{ background: 'linear-gradient(135deg,#ECFDF5,#D1FAE5)' }}>
          <p className="text-[10px] font-black uppercase tracking-wider text-green-600">Total paid out</p>
          <p className="text-2xl font-black text-green-700 mt-1">{money(m.paidTotal)}</p>
        </div>
        <div className="rounded-xl p-4 text-center" style={{ background: 'linear-gradient(135deg,#FFFBEB,#FEF3C7)' }}>
          <p className="text-[10px] font-black uppercase tracking-wider text-amber-600">Pending / owed</p>
          <p className="text-2xl font-black text-amber-700 mt-1">{money(m.pendTotal)}</p>
        </div>
      </div>

      {/* Source breakdown */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
          <p className="text-xs font-black text-slate-700">Breakdown by source</p>
        </div>
        {srcRow('Base + Order pay', m.paid.baseOrder, m.pend.baseOrder, '#0891B2')}
        {srcRow('Travel expense', m.paid.travel, m.pend.travel, '#D97706')}
        {srcRow('Refer & Earn', m.paid.referral, m.pend.referral, '#7C3AED')}
        {srcRow('Tier bonus', m.paid.tier, m.pend.tier, '#059669')}
      </div>

      {m.shiftHours != null && (
        <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-slate-200">
          <p className="text-xs text-slate-400">Shift hours (current period)</p>
          <p className="text-sm font-bold text-slate-700">{Number(m.shiftHours).toFixed(1)} h</p>
        </div>
      )}
      <p className="text-[11px] text-slate-400 text-center">Reporting view across all four sources. Paid = actually disbursed; Pending = earned but not yet withdrawn.</p>
    </div>
  )
}

// ── Referrals tab ───────────────────────────────────────────────
function ReferralsTab({ workerId }: { workerId: string }) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/referrals?status=all&worker_id=${workerId}`, { cache: 'no-store' })
      const j = await res.json()
      setRows(j.referrals ?? j.rows ?? [])
    } catch { setRows([]) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [workerId])

  async function act(id: string, action: string) {
    let reason: string | undefined
    if (action === 'reject') { const r = window.prompt('Reason:'); if (r === null) return; reason = r }
    setBusy(id)
    try {
      await fetch('/api/referrals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, reason }),
      })
      await load()
    } finally { setBusy(null) }
  }

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Loading referrals…</div>
  if (rows.length === 0) return (
    <div className="p-8 text-center">
      <p className="text-3xl mb-2">🎁</p>
      <p className="text-slate-600 font-bold text-sm">No referrals yet</p>
    </div>
  )

  const RST: Record<string, { bg: string; fg: string }> = {
    joined: { bg: '#f1f5f9', fg: '#64748b' }, earned: { bg: '#fef3c7', fg: '#b45309' },
    paid: { bg: '#dcfce7', fg: '#15803d' }, rejected: { bg: '#fee2e2', fg: '#b91c1c' },
  }

  return (
    <div className="p-5 space-y-3">
      {rows.map(r => {
        const st = RST[r.status] ?? RST.joined
        return (
          <div key={r.id} className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-800">{r.referred ?? '—'}</p>
                <p className="text-[11px] text-slate-400">Code {r.code ?? '—'} · {r.jobs ?? 0} job(s)</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-black text-cyan-700">{money(r.amount)}</p>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.fg }}>{r.status}</span>
              </div>
            </div>
            {r.status === 'earned' && (
              <div className="flex gap-2 mt-3">
                <button disabled={busy === r.id} onClick={() => act(r.id, 'pay')}
                  className="flex-1 py-2 rounded-lg text-xs font-black text-white disabled:opacity-40" style={{ background: '#15803d' }}>Pay</button>
                <button disabled={busy === r.id} onClick={() => act(r.id, 'reject')}
                  className="flex-1 py-2 rounded-lg text-xs font-black text-white disabled:opacity-40" style={{ background: '#dc2626' }}>Reject</button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Tier tab ────────────────────────────────────────────────────
function TierTab({ workerId }: { workerId: string }) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/tiers?status=all&worker_id=${workerId}`, { cache: 'no-store' })
      const j = await res.json()
      setRows(j.rewards ?? j.rows ?? [])
    } catch { setRows([]) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [workerId])

  async function act(id: string, action: string) {
    let reason: string | undefined
    if (action === 'reject') { const r = window.prompt('Reason:'); if (r === null) return; reason = r }
    setBusy(id)
    try {
      await fetch('/api/tiers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, reason }),
      })
      await load()
    } finally { setBusy(null) }
  }

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Loading tiers…</div>
  if (rows.length === 0) return (
    <div className="p-8 text-center">
      <p className="text-3xl mb-2">🏆</p>
      <p className="text-slate-600 font-bold text-sm">No tier rewards yet</p>
    </div>
  )

  const TST: Record<string, { bg: string; fg: string }> = {
    earned: { bg: '#fef3c7', fg: '#b45309' }, paid: { bg: '#dcfce7', fg: '#15803d' }, rejected: { bg: '#fee2e2', fg: '#b91c1c' },
  }

  return (
    <div className="p-5 space-y-3">
      {rows.map(r => {
        const st = TST[r.status] ?? TST.earned
        return (
          <div key={r.id} className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-black text-slate-800 capitalize">{r.tier} tier</p>
                <p className="text-[11px] text-slate-400">Reached at {r.orders_at ?? '—'} orders</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-black text-cyan-700">{money(r.amount)}</p>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.fg }}>{r.status}</span>
              </div>
            </div>
            {r.status === 'earned' && (
              <div className="flex gap-2 mt-3">
                <button disabled={busy === r.id} onClick={() => act(r.id, 'pay')}
                  className="flex-1 py-2 rounded-lg text-xs font-black text-white disabled:opacity-40" style={{ background: '#15803d' }}>Pay bonus</button>
                <button disabled={busy === r.id} onClick={() => act(r.id, 'reject')}
                  className="flex-1 py-2 rounded-lg text-xs font-black text-white disabled:opacity-40" style={{ background: '#dc2626' }}>Reject</button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── SOS tab (direct query) ──────────────────────────────────────
function SosTab({ workerId, supabase }: { workerId: string; supabase: any }) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const { data } = await supabase.from('sos_alerts')
        .select('id, lat, lng, status, created_at, resolved_at')
        .eq('worker_id', workerId)
        .order('created_at', { ascending: false })
      setRows(data ?? [])
    } catch { setRows([]) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [workerId])

  async function resolve(id: string) {
    setBusy(id)
    try {
      await supabase.from('sos_alerts').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', id)
      await load()
    } finally { setBusy(null) }
  }

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Loading SOS…</div>
  if (rows.length === 0) return (
    <div className="p-8 text-center">
      <p className="text-3xl mb-2">🆘</p>
      <p className="text-slate-600 font-bold text-sm">No SOS alerts</p>
      <p className="text-[11px] text-slate-400 mt-1">This worker hasn&apos;t triggered any emergency alerts.</p>
    </div>
  )

  return (
    <div className="p-5 space-y-3">
      {rows.map(r => {
        const active = r.status === 'active'
        return (
          <div key={r.id} className="rounded-xl border p-4"
            style={{ borderColor: active ? '#FECACA' : '#E2E8F0', background: active ? '#FEF2F2' : '#fff' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-black" style={{ color: active ? '#b91c1c' : '#334155' }}>
                  {active ? '🔴 Active alert' : '✓ Resolved'}
                </p>
                <p className="text-[11px] text-slate-400">{new Date(r.created_at).toLocaleString('en-IN')}</p>
              </div>
              {r.lat && r.lng && (
                <a href={`https://www.google.com/maps?q=${r.lat},${r.lng}`} target="_blank" rel="noreferrer"
                  className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600">📍 Map</a>
              )}
            </div>
            {active && (
              <button disabled={busy === r.id} onClick={() => resolve(r.id)}
                className="w-full mt-3 py-2 rounded-lg text-xs font-black text-white disabled:opacity-40" style={{ background: '#15803d' }}>
                Mark resolved
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ScheduleRequestTab — worker-initiated schedule change requests
// ═══════════════════════════════════════════════════════════════════

const SCHED_DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
const SCHED_SHORT: Record<string, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
  friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
}

function schedToMins(t: string) {
  const [h, m] = (t ?? '0:0').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
function schedLabel(mins: number) {
  const h = Math.floor(mins / 60), m = mins % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}
function schedDayNet(day: any): number {
  if (!day || day.enabled !== true) return 0
  const s = schedToMins(day.start), e = schedToMins(day.end)
  let total = e - s
  if (total <= 0) return 0
  for (const b of (day.breaks ?? [])) {
    const bs = Math.max(schedToMins(b.from), s)
    const be = Math.min(schedToMins(b.to), e)
    total -= Math.max(0, be - bs)
  }
  return Math.max(0, total)
}
function schedWeekNet(sched: any): number {
  if (!sched) return 0
  return SCHED_DAYS.reduce((sum, d) => sum + schedDayNet(sched[d]), 0)
}

function ScheduleRequestTab({ workerId, onChanged }: { workerId: string; onChanged: () => void }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setLoading(true); setErr(null)
    try {
      const res = await fetch(
        `/api/schedule-requests?status=all&worker_id=${workerId}`,
        { cache: 'no-store' }
      )
      setData(await res.json())
    } catch { setData(null) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [workerId])

  async function act(id: string, action: 'approve' | 'reject') {
    let reason: string | undefined
    if (action === 'reject') {
      const r = window.prompt('Reason for rejection (the worker will see this):')
      if (r === null) return
      reason = r
    }
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/schedule-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, reason }),
      })
      const j = await res.json()
      if (!res.ok) { setErr(j.error ?? 'Action failed'); return }
      await load()
      onChanged()
    } finally { setBusy(false) }
  }

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Loading schedule…</div>
  if (!data) return <div className="p-8 text-center text-slate-400 text-sm">No response from server.</div>

  const requests: any[] = data.requests ?? []
  const pending = requests.find(r => r.status === 'pending')
  const history = requests.filter(r => r.status !== 'pending')
  const current = data.current
  const conflicts: any[] = data.conflicts ?? []

  return (
    <div className="p-5 space-y-4">

      {err && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3">
          <p className="text-sm font-bold text-red-700">{err}</p>
        </div>
      )}

      {/* ── Current live schedule ── */}
      <div>
        <p className="text-[11px] font-black uppercase tracking-wide text-slate-400 mb-2">
          Current schedule {current ? `· ${schedLabel(schedWeekNet(current))}/week` : ''}
        </p>
        {current ? <SchedGrid sched={current} /> : (
          <div className="rounded-xl border border-slate-200 p-4 text-center">
            <p className="text-sm text-slate-400">No schedule set yet</p>
          </div>
        )}
      </div>

      {/* ── Pending request ── */}
      {pending ? (
        <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: '#FCD34D' }}>
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
            <div>
              <p className="text-xs font-black text-amber-800">⏳ Pending request</p>
              <p className="text-[11px] text-amber-700 mt-0.5">
                Asking for {schedLabel(pending.net_week_mins)}/week
                {current ? ` (currently ${schedLabel(schedWeekNet(current))})` : ''}
              </p>
            </div>
            <p className="text-[11px] text-slate-500">
              {new Date(pending.requested_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </p>
          </div>

          <div className="p-4 space-y-3">
            <SchedGrid sched={pending.proposed} highlight />

            {pending.note && (
              <p className="text-[12px] text-slate-600 italic">Note: {pending.note}</p>
            )}

            {/* Estimated base pay change */}
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-[11px] text-slate-500">Est. base pay (₹50/hr)</span>
              <span className="text-[13px] font-black text-cyan-700">
                ₹{Math.round((pending.net_week_mins / 60) * 50).toLocaleString('en-IN')}/week
              </span>
            </div>

            {/* Conflict warning */}
            {conflicts.length > 0 ? (
              <div className="rounded-xl bg-red-50 border border-red-200 p-3">
                <p className="text-xs font-black text-red-700 mb-1.5">
                  ⚠ {conflicts.length} booking{conflicts.length > 1 ? 's' : ''} would break
                </p>
                <div className="space-y-1">
                  {conflicts.slice(0, 5).map((c: any, i: number) => (
                    <p key={i} className="text-[11px] text-red-600">
                      • {new Date(c.scheduled_at).toLocaleString('en-IN', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      {' — '}{c.reason}
                    </p>
                  ))}
                  {conflicts.length > 5 && (
                    <p className="text-[11px] text-red-500">…and {conflicts.length - 5} more</p>
                  )}
                </div>
                <p className="text-[11px] text-red-500 mt-2">
                  Approval is blocked until these bookings are moved or cancelled.
                </p>
              </div>
            ) : (
              <div className="rounded-xl bg-green-50 border border-green-200 px-3 py-2">
                <p className="text-xs font-bold text-green-700">✓ No booking conflicts — safe to approve</p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button disabled={busy} onClick={() => act(pending.id, 'reject')}
                className="flex-1 py-2.5 rounded-xl font-bold text-white text-sm disabled:opacity-40"
                style={{ background: '#dc2626' }}>
                {busy ? '…' : 'Reject'}
              </button>
              <button disabled={busy || conflicts.length > 0} onClick={() => act(pending.id, 'approve')}
                className="flex-1 py-2.5 rounded-xl font-bold text-white text-sm disabled:opacity-40"
                style={{ background: conflicts.length > 0 ? '#94a3b8' : '#16a34a' }}>
                {busy ? '…' : conflicts.length > 0 ? 'Blocked' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 p-4 text-center">
          <p className="text-sm text-slate-500 font-semibold">No pending request</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            The worker can propose new hours from their app.
          </p>
        </div>
      )}

      {/* ── History ── */}
      {history.length > 0 && (
        <div>
          <p className="text-[11px] font-black uppercase tracking-wide text-slate-400 mb-2">
            Past requests
          </p>
          <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
            {history.slice(0, 8).map((r: any) => (
              <div key={r.id} className="flex items-center justify-between px-3 py-2.5">
                <div>
                  <p className="text-[12px] font-bold text-slate-700">
                    {schedLabel(r.net_week_mins)}/week
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {new Date(r.requested_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
                    {r.reject_reason ? ` · ${r.reject_reason}` : ''}
                  </p>
                </div>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full"
                  style={{
                    background: r.status === 'approved' ? '#dcfce7' : '#fee2e2',
                    color: r.status === 'approved' ? '#15803d' : '#b91c1c',
                  }}>
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/// Compact 7-day grid used for both current and proposed schedules.
function SchedGrid({ sched, highlight }: { sched: any; highlight?: boolean }) {
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {SCHED_DAYS.map(d => {
        const day = sched?.[d]
        const on = day?.enabled === true
        const net = schedDayNet(day)
        const breaks = (day?.breaks ?? []).length
        return (
          <div key={d} className="rounded-xl p-2 text-center border"
            style={{
              background: !on ? '#F8FAFC' : highlight ? '#FFFBEB' : '#ECFEFF',
              borderColor: !on ? '#F1F5F9' : highlight ? '#FDE68A' : '#A5F3FC',
            }}>
            <p className="text-[9px] font-black text-slate-400">{SCHED_SHORT[d]}</p>
            {on ? (
              <>
                <p className="text-[10px] font-black mt-0.5"
                  style={{ color: highlight ? '#B45309' : '#0891B2' }}>
                  {schedLabel(net)}
                </p>
                <p className="text-[8px] text-slate-400 mt-0.5 leading-tight">
                  {day.start}–{day.end}
                </p>
                {breaks > 0 && (
                  <p className="text-[8px] text-amber-600">{breaks} brk</p>
                )}
              </>
            ) : (
              <p className="text-[10px] text-slate-300 mt-0.5">–</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Worker Detail Panel ─────────────────────────────────────────
function WorkerDetail({ w, index, onClose, onEdit, onDelete, onToggle, onScheduleSave, toggling, onReload }: {
  w: Worker; index: number; onClose: () => void
  onEdit: () => void; onDelete: () => void
  onToggle: (field: 'is_available'|'is_active') => void
  onScheduleSave: (id: string, sched: WeekSchedule) => void
  toggling: string | null
  onReload: () => void
}) {
  const avatarColors = ['#0891B2','#0E7490','#06B6D4','#0891B2','#155E75','#0E7490']
  const avatarBg     = avatarColors[index % avatarColors.length]
  const completionRate = w.totalOrders > 0 ? Math.round((w.completed / w.totalOrders) * 100) : 0
  const inShift      = isWithinShift(w.schedule)
  const weekMins     = weeklyNetMins(w.schedule)
  const st           = statusOf(w)

  const [tab, setTab]             = useState<'overview'|'approval'|'schedule'|'schedreq'|'hours'|'jobs'|'payouts'|'earnings'|'referrals'|'tier'|'sos'>('overview')
  const [editingSched, setEditing] = useState(false)
  const [editSched,  setEditSched]  = useState<WeekSchedule>(w.schedule ?? { ...DEFAULT_SCHEDULE })
  const [savingSched, setSavingSched] = useState(false)
  const [jobsShown, setJobsShown] = useState(10)

  useEffect(() => {
    setEditSched(w.schedule ?? { ...DEFAULT_SCHEDULE })
    setEditing(false)
    setTab('overview')
    setJobsShown(10)
  }, [w.id])

  async function saveSched() {
    setSavingSched(true)
    await onScheduleSave(w.id, editSched)
    setSavingSched(false)
    setEditing(false)
  }

  const TABS = [
    { key: 'overview' as const, label: 'Overview', icon: '▦' },
    { key: 'approval' as const, label: 'Approval & KYC', icon: '✅' },
    { key: 'schedule' as const, label: 'Schedule', icon: '🗓' },
    { key: 'schedreq' as const, label: 'Schedule req', icon: '🗓' },
    { key: 'hours'    as const, label: 'Hours',    icon: '⏱' },
    { key: 'jobs'     as const, label: 'Jobs',     icon: '≡' },
    { key: 'payouts'  as const, label: 'Payouts',  icon: '💸' },
    { key: 'earnings' as const, label: 'Earnings', icon: '₹' },
    { key: 'referrals'as const, label: 'Referrals',icon: '🎁' },
    { key: 'tier'     as const, label: 'Tier',     icon: '🏆' },
    { key: 'sos'      as const, label: 'SOS',      icon: '🆘' },
  ]

  return (
    <div className="bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm">

      {/* ── Premium header ── */}
      <div className="relative px-6 pt-6 pb-5 overflow-hidden"
        style={{ background: `linear-gradient(135deg,${avatarBg}0D,transparent 60%)` }}>
        <button onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-white/70 backdrop-blur text-slate-400 flex items-center justify-center hover:bg-white hover:text-slate-600 transition-all border border-slate-200/60">✕</button>

        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center font-black text-2xl text-white"
              style={{ background: `linear-gradient(135deg,${avatarBg},${avatarBg}BB)`, opacity: w.is_active ? 1 : 0.5, boxShadow: `0 8px 20px ${avatarBg}35` }}>
              {w.full_name[0]?.toUpperCase()}
            </div>
            <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-[3px] border-white" style={{ background: st.color }}/>
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-black text-slate-900 leading-tight truncate">{w.full_name}</h2>
            <p className="text-sm text-slate-500 mt-0.5">+91 {w.phone}</p>
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border"
                style={{ background: `${st.color}12`, color: st.color, borderColor: `${st.color}30` }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: st.color }}/>{st.label}
              </span>
              {w.is_verified && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-700 border border-cyan-200">✓ Verified</span>}
              {!w.is_active && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">Inactive</span>}
            </div>
          </div>
        </div>

        {/* live job banner */}
        {w.is_busy && w.current_service && w.work_started_at && (
          <div className="mt-4 px-3 py-2.5 rounded-xl bg-white border border-amber-200 flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-wider text-amber-600">⚡ On a job now</p>
              <p className="text-xs font-bold text-slate-700 truncate">{w.current_service}</p>
            </div>
            <LiveTimer start={w.work_started_at} color="#D97706"/>
          </div>
        )}

        {/* action row */}
        <div className="flex gap-2 mt-4">
          {w.phone && (
            <a href={`tel:+91${w.phone}`} className="flex-1 h-9 rounded-lg flex items-center justify-center gap-1.5 text-xs font-bold bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:text-slate-800 transition-all">
              📞 Call
            </a>
          )}
          <button onClick={onEdit} className="flex-1 h-9 rounded-lg flex items-center justify-center gap-1.5 text-xs font-bold bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:text-slate-800 transition-all">
            ✏️ Edit
          </button>
          <button onClick={onDelete} className="w-9 h-9 rounded-lg flex items-center justify-center text-xs bg-white text-red-400 border border-slate-200 hover:border-red-200 hover:bg-red-50 transition-all">🗑</button>
        </div>
      </div>

      {/* ── OTP strip (if set) ── */}
      {w.worker_otp && (
        <div className="px-6 py-2.5 bg-violet-50/50 border-y border-violet-100 flex items-center justify-between">
          <span className="text-[11px] font-bold text-violet-500 uppercase tracking-wide">🔐 Worker OTP</span>
          <span className="font-mono font-black text-lg tracking-[0.2em] text-violet-700">{w.worker_otp}</span>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex gap-1 px-4 pt-3 border-b border-slate-100">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="relative px-3 py-2 text-xs font-bold transition-colors"
            style={{ color: tab === t.key ? avatarBg : '#94A3B8' }}>
            {t.label}
            {tab === t.key && <span className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full" style={{ background: avatarBg }}/>}
          </button>
        ))}
      </div>

      <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 340px)' }}>

        {/* ── OVERVIEW TAB ── */}
        {tab === 'overview' && (
          <div className="p-5 space-y-4">
            {/* stat tiles */}
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { label: 'Revenue',   value: `₹${w.totalRevenue.toLocaleString('en-IN')}`, accent: '#0891B2' },
                { label: 'Total Jobs',value: w.totalOrders, accent: '#7C3AED' },
                { label: 'Completed', value: w.completed,   accent: '#059669' },
                { label: 'Weekly Hrs',value: weekMins > 0 ? minsToLabel(weekMins) : '—', accent: '#D97706' },
              ].map(s => (
                <div key={s.label} className="rounded-xl border border-slate-200 p-3.5">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">{s.label}</p>
                  <p className="text-xl font-black leading-none" style={{ color: s.accent }}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* completion */}
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex justify-between mb-2">
                <p className="text-xs font-semibold text-slate-500">Completion rate</p>
                <p className="text-sm font-black text-slate-700">{completionRate}%</p>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${completionRate}%`, background: `linear-gradient(90deg,${avatarBg},${avatarBg}99)` }}/>
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">{w.completed} of {w.totalOrders} jobs completed</p>
            </div>

            {/* availability toggles */}
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { field: 'is_available' as const, label: w.is_busy ? 'On a Job' : w.is_available ? 'Mark Unavailable' : 'Mark Available', color: '#059669', on: w.is_available, disabled: w.is_busy || !w.is_active },
                { field: 'is_active'    as const, label: w.is_active ? 'Deactivate' : 'Activate', color: '#7C3AED', on: w.is_active, disabled: false },
              ].map(ctrl => (
                <button key={ctrl.field} onClick={() => !ctrl.disabled && onToggle(ctrl.field)}
                  disabled={ctrl.disabled || toggling === ctrl.field}
                  className="rounded-xl px-3 py-3 text-left transition-all border hover:border-slate-300 disabled:opacity-40 active:scale-[0.98]"
                  style={{ borderColor: ctrl.on ? `${ctrl.color}40` : '#E2E8F0', background: ctrl.on ? `${ctrl.color}0A` : '#fff' }}>
                  <p className="text-xs font-black" style={{ color: ctrl.on ? ctrl.color : '#94A3B8' }}>
                    {toggling === ctrl.field ? 'Updating…' : ctrl.label}
                  </p>
                </button>
              ))}
            </div>

            {/* completed work by service */}
            {w.serviceBreakdown.length > 0 && (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <p className="text-xs font-black text-slate-700">✅ Completed work by service</p>
                  <span className="text-[11px] font-black text-cyan-700">
                    ₹{w.serviceBreakdown.reduce((s, x) => s + x.income, 0).toLocaleString('en-IN')} total
                  </span>
                </div>
                <div className="divide-y divide-slate-100">
                  {w.serviceBreakdown.map(sv => (
                    <div key={sv.name} className="flex items-center justify-between px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold text-slate-800 truncate">{sv.name}</p>
                        <p className="text-[11px] text-slate-400">{sv.count} job{sv.count > 1 ? 's' : ''} · {secsToHrsLabel(sv.secs)}</p>
                      </div>
                      <p className="text-[13px] font-black text-cyan-700 flex-shrink-0">₹{sv.income.toLocaleString('en-IN')}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* member since */}
            {(w.joined_at || w.created_at) && (
              <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-slate-200">
                <p className="text-xs text-slate-400">Member since</p>
                <p className="text-xs font-bold text-slate-700">{new Date(w.joined_at ?? w.created_at!).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
              </div>
            )}
          </div>
        )}

        {/* ── SCHEDULE TAB ── */}
        {tab === 'schedule' && (
          <div className="p-5">
            {editingSched ? (
              <div className="rounded-xl border border-cyan-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-cyan-50 border-b border-cyan-200">
                  <p className="text-xs font-black text-cyan-800">Edit Weekly Schedule</p>
                  <div className="flex gap-2">
                    <button onClick={() => { setEditing(false); setEditSched(w.schedule ?? { ...DEFAULT_SCHEDULE }) }}
                      className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-white text-slate-500 border border-slate-200">Cancel</button>
                    <button onClick={saveSched} disabled={savingSched}
                      className="text-[11px] font-black px-3 py-1.5 rounded-lg text-white disabled:opacity-50"
                      style={{ background: 'linear-gradient(135deg,#0891B2,#0E7490)' }}>
                      {savingSched ? 'Saving…' : '✓ Save'}
                    </button>
                  </div>
                </div>
                <div className="p-3">
                  <ScheduleEditor schedule={editSched} onChange={setEditSched}/>
                  <div className="mt-3 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                    <p className="text-xs text-slate-400">Total weekly net hours</p>
                    <p className="text-sm font-black text-cyan-700">{minsToLabel(weeklyNetMins(editSched))}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-black text-slate-600">Work Schedule</p>
                  <button onClick={() => setEditing(true)}
                    className="text-[11px] font-black px-3 py-1.5 rounded-lg text-cyan-700 bg-cyan-50 border border-cyan-200 hover:bg-cyan-100 transition-all">
                    ✏️ Edit schedule
                  </button>
                </div>
                <ScheduleSummary schedule={w.schedule}/>
              </div>
            )}
          </div>
        )}

        {/* ── SCHEDULE REQUEST TAB (worker-initiated schedule change requests) ── */}
        {tab === 'schedreq' && <ScheduleRequestTab workerId={w.id} onChanged={onReload} />}

        {/* ── HOURS TAB ── */}
        {tab === 'hours' && (
          <div className="p-5">
            <WorkHoursPanel w={w}/>
          </div>
        )}

        {/* ── JOBS TAB (completed work: date · income · hours) ── */}
        {tab === 'jobs' && (
          <div className="p-5">
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-2">Completed Jobs ({w.completedList.length})</p>
            {w.completedList.length === 0
              ? <div className="rounded-xl p-8 text-center border border-slate-200"><p className="text-slate-400 text-sm">No completed jobs yet</p></div>
              : (
                <>
                <div className="space-y-2">
                  {w.completedList.slice(0, jobsShown).map(job => {
                    const jobDur = job.work_started_at && job.work_ended_at ? elapsed(job.work_started_at, job.work_ended_at) : null
                    const doneOn = job.work_ended_at ?? job.scheduled_at
                    return (
                      <div key={job.id} className="rounded-xl p-3 border border-slate-100 hover:border-slate-200 transition-all">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-slate-800 font-semibold text-xs truncate">{job.service_name}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">📅 {new Date(doneOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })} · 📍 {job.area}</p>
                            {jobDur && <p className="text-[10px] text-green-600 mt-0.5 font-mono">⏱ {dur(jobDur)}</p>}
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: '#D1FAE5', color: '#059669' }}>Done</span>
                            <p className="text-xs font-black text-cyan-700">₹{job.final_amount.toLocaleString('en-IN')}</p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                {jobsShown < w.completedList.length && (
                  <button onClick={() => setJobsShown(n => n + 10)}
                    className="w-full mt-3 py-2.5 rounded-xl text-xs font-black text-cyan-700 bg-cyan-50 border border-cyan-200 hover:bg-cyan-100 transition-all">
                    Load more ({w.completedList.length - jobsShown} left)
                  </button>
                )}
                </>
              )
            }
          </div>
        )}

        {/* ── APPROVAL TAB (details + documents + approve/reject) ── */}
        {tab === 'approval' && <ApprovalTab workerId={w.id} onChanged={onReload} />}

        {/* ── UNIFIED TABS ── */}
        {tab === 'payouts' && <PayoutsTab workerId={w.id} />}
        {tab === 'earnings' && <EarningsTab workerId={w.id} />}
        {tab === 'referrals' && <ReferralsTab workerId={w.id} />}
        {tab === 'tier' && <TierTab workerId={w.id} />}
        {tab === 'sos' && <SosTab workerId={w.id} supabase={createClient()} />}

      </div>
    </div>
  )
}
// ── Worker Form ─────────────────────────────────────────────────
function WorkerForm({ mode, init, onClose, onSaved }: { mode: 'add'|'edit'; init: any; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(init)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }))

  async function save() {
    if (!form.full_name.trim()) { setErr('Name required'); return }
    if (form.phone.replace(/\D/g,'').length < 10) { setErr('Valid 10-digit phone required'); return }

    // Worker OTP is required and must be unique across all workers.
    const code = (form.worker_otp ?? '').trim()
    if (code.length < 4) { setErr('Worker OTP is required (4 digits)'); return }

    setSaving(true); setErr('')

    // Uniqueness check: does another worker already use this code?
    try {
      const sb = createClient()
      let q = sb.from('workers').select('user_id').eq('worker_otp', code)
      // When editing, exclude this same worker from the check.
      if (mode === 'edit' && form.id) q = q.neq('user_id', form.id)
      const { data: clash } = await q.limit(1)
      if (clash && clash.length > 0) {
        setSaving(false)
        setErr(`Code ${code} is already taken by another worker. Please choose a different code.`)
        return
      }
    } catch (e) {
      // If the check itself fails, let the DB unique constraint be the backstop.
      // (Do not block saving on a transient read error.)
    }

    const url  = mode === 'add' ? '/api/workers/create' : '/api/workers/update'
    const body = mode === 'add'
      ? { full_name: form.full_name.trim(), phone: form.phone.replace(/\D/g,'').slice(-10), email: form.email?.trim() ?? '', is_available: form.is_available, worker_otp: form.worker_otp?.trim() || null }
      : { id: form.id, full_name: form.full_name.trim(), phone: form.phone.replace(/\D/g,'').slice(-10), email: form.email?.trim() ?? '', is_available: form.is_available, is_verified: form.is_verified ?? false, is_active: form.is_active ?? true, worker_otp: form.worker_otp?.trim() || null }
    const res  = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json(); setSaving(false)
    if (!res.ok) {
      const msg = String(data.error || 'Error saving')
      // Backstop: DB unique constraint rejected a duplicate code.
      if (msg.toLowerCase().includes('worker_otp') || msg.toLowerCase().includes('unique')) {
        setErr(`Code ${code} is already taken by another worker. Please choose a different code.`)
      } else {
        setErr(msg)
      }
      return
    }
    onSaved()
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose}/>
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md flex flex-col bg-white"
        style={{ borderLeft: '1px solid #E2E8F0', boxShadow: '-20px 0 60px rgba(0,0,0,0.1)' }}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-black text-slate-800">{mode === 'add' ? '+ Add Worker' : '✏️ Edit Worker'}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{mode === 'add' ? 'Add a new team member' : 'Update worker details'}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
          <div className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-black text-2xl text-white flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#0891B2,#0E7490)' }}>
              {form.full_name ? form.full_name[0].toUpperCase() : '?'}
            </div>
            <div>
              <p className="font-bold text-slate-700">{form.full_name || 'Worker Name'}</p>
              <p className="text-xs text-slate-400">{form.phone || 'Phone number'}</p>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1.5">Full Name *</label>
            <input value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="e.g. Rahul Sharma"
              className="w-full px-4 py-3 rounded-xl text-slate-800 text-sm outline-none bg-white border border-slate-200 placeholder-slate-300"/>
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1.5">Phone *</label>
            <div className="flex items-center rounded-xl overflow-hidden border border-slate-200">
              <span className="px-3 py-3 text-sm font-bold bg-slate-50 text-slate-500 border-r border-slate-200 flex-shrink-0">+91</span>
              <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value.replace(/\D/g,'').slice(0,10))} placeholder="98765 43210"
                className="flex-1 px-4 py-3 text-slate-800 text-sm outline-none placeholder-slate-300"/>
              {form.phone?.length === 10 && <span className="pr-4 text-green-600 font-bold">✓</span>}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1.5">Email (optional)</label>
            <input type="email" value={form.email ?? ''} onChange={e => set('email', e.target.value)} placeholder="rahul@example.com"
              className="w-full px-4 py-3 rounded-xl text-slate-800 text-sm outline-none bg-white border border-slate-200 placeholder-slate-300"/>
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1.5">
              Worker OTP <span className="text-violet-500">*</span>
            </label>
            <p className="text-[10px] text-slate-400 mb-2">Permanent OTP worker gives to customer when they arrive. Customer enters this to start the job.</p>
            <input
              type="text"
              value={form.worker_otp ?? ''}
              onChange={e => set('worker_otp', e.target.value.replace(/\D/g,'').slice(0,6))}
              placeholder="e.g. 4821"
              maxLength={6}
              className="w-full px-4 py-3 rounded-xl text-slate-800 text-xl font-black font-mono tracking-widest outline-none bg-violet-50 border border-violet-200 placeholder-slate-300 focus:border-violet-400"
            />
            {form.worker_otp && form.worker_otp.length >= 3 && (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-50 border border-violet-200">
                <span>🔐</span>
                <p className="text-xs text-violet-700 font-bold">Worker will say <span className="font-mono font-black text-base tracking-widest">{form.worker_otp}</span> to customer</p>
              </div>
            )}
          </div>
          {[
            { key: 'is_available', label: 'Available for Jobs', sub: 'Appears in assignment dropdown', color: '#059669', bg: '#ECFDF5', border: '#6EE7B7' },
            ...(mode === 'edit' ? [
              { key: 'is_verified', label: 'ID Verified',    sub: 'Aadhaar / ID verified',      color: '#0891B2', bg: '#ECFEFF', border: '#67E8F9' },
              { key: 'is_active',   label: 'Account Active', sub: 'Can receive job assignments', color: '#7C3AED', bg: '#F5F3FF', border: '#C4B5FD' },
            ] : []),
          ].map(t => (
            <button key={t.key} onClick={() => set(t.key, !form[t.key])}
              className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl transition-all border"
              style={{ background: form[t.key] ? t.bg : '#F8FAFC', borderColor: form[t.key] ? t.border : '#E2E8F0' }}>
              <div className="text-left">
                <p className="text-sm font-bold text-slate-700">{t.label}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{t.sub}</p>
              </div>
              <div className="w-11 h-6 rounded-full relative flex-shrink-0" style={{ background: form[t.key] ? t.color : '#CBD5E1' }}>
                <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all" style={{ left: form[t.key] ? '22px' : '2px' }}/>
              </div>
            </button>
          ))}
          {err && <p className="text-sm font-bold text-red-600 bg-red-50 px-4 py-3 rounded-xl border border-red-200">⚠️ {err}</p>}
        </div>
        <div className="px-6 py-5 border-t border-slate-100">
          <button onClick={save} disabled={saving}
            className="w-full h-14 rounded-2xl text-white font-black text-base disabled:opacity-50 active:scale-[0.98] transition-all"
            style={{ background: 'linear-gradient(135deg,#0891B2,#0E7490)', boxShadow: '0 8px 24px rgba(8,145,178,0.22)' }}>
            {saving ? 'Saving…' : mode === 'add' ? '+ Add Worker' : '✓ Save Changes'}
          </button>
        </div>
      </div>
    </>
  )
}

function DeleteModal({ worker, onClose, onDone }: { worker: Worker; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  async function del() {
    setBusy(true)
    await fetch('/api/workers/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: worker.id }) })
    setBusy(false); onDone()
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-3xl p-6 space-y-5 bg-white border border-red-200 shadow-2xl">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-3 bg-red-50">🗑️</div>
          <h3 className="text-slate-800 font-black text-lg">Remove Worker?</h3>
          <p className="text-sm text-slate-500 mt-2"><strong className="text-slate-700">{worker.full_name}</strong> will be removed. History preserved.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 h-12 rounded-2xl font-bold text-sm bg-slate-100 text-slate-500">Cancel</button>
          <button onClick={del} disabled={busy} className="flex-1 h-12 rounded-2xl font-black text-sm text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#EF4444,#DC2626)' }}>
            {busy ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Status colour (matches maps: green/amber/grey + more) ──────
function statusOf(w: Worker): { color: string; label: string } {
  const inShift = isWithinShift(w.schedule)
  if (!w.is_active)                       return { color: '#DC2626', label: 'Inactive' }
  if (w.is_busy)                          return { color: '#D97706', label: 'On job' }
  if (w.is_available && inShift)          return { color: '#059669', label: 'Free' }
  if (w.is_available && !inShift && w.schedule) return { color: '#F97316', label: 'Off shift' }
  return { color: '#94A3B8', label: 'Unavailable' }
}

// ── Main Page ───────────────────────────────────────────────────
export default function AdminWorkers() {
  const [workers,  setWorkers]  = useState<Worker[]>([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [selected, setSelected] = useState<Worker | null>(null)
  const [selIndex, setSelIndex] = useState(0)
  const [drawer,   setDrawer]   = useState<null|'add'|'edit'>(null)
  const [toDelete, setToDelete] = useState<Worker | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const supabase = createClient()

  async function load() {
    setLoading(true)
    const [{ data: users }, { data: wRows }, { data: bkng }, { data: active }] = await Promise.all([
      supabase.from('users').select('id,full_name,phone,email,created_at,is_active').eq('role','worker'),
      supabase.from('workers').select('user_id,is_available,is_verified,joined_at,schedule,worker_otp'),
      supabase.from('bookings').select('worker_id,status,final_amount,scheduled_at,work_started_at,work_ended_at,work_duration_seconds,services(name),addresses(area)').order('created_at', { ascending: false }),
      supabase.from('bookings').select('worker_id,work_started_at,services(name)').eq('status','in_progress'),
    ])
    const wMap: Record<string,any> = {}
    ;(wRows ?? []).forEach((w: any) => { wMap[w.user_id] = w })
    const busyMap: Record<string,any> = {}
    ;(active ?? []).forEach((b: any) => { if (b.worker_id) busyMap[b.worker_id] = { service: b.services?.name ?? 'Service', work_started_at: b.work_started_at ?? new Date().toISOString() } })

    const list: Worker[] = (users ?? []).map((u: any) => {
      const w    = wMap[u.id] ?? {}
      const wb   = (bkng ?? []).filter((b: any) => b.worker_id === u.id)
      const comp = wb.filter((b: any) => b.status === 'completed')
      const rev  = comp.reduce((s: number, b: any) => s + (b.final_amount ?? 0), 0)
      const busy = busyMap[u.id]
      const recentBookings: RecentJob[] = wb.slice(0, 10).map((b: any) => ({
        id: b.id ?? Math.random().toString(),
        service_name: b.services?.name ?? 'Service',
        area: b.addresses?.area ?? '—',
        status: b.status, final_amount: b.final_amount ?? 0, scheduled_at: b.scheduled_at,
        work_started_at: b.work_started_at ?? null, work_ended_at: b.work_ended_at ?? null,
      }))
      // by-service breakdown (all completed jobs)
      const svcMap: Record<string, ServiceStat> = {}
      for (const b of comp) {
        const nm = b.services?.name ?? 'Service'
        const secs = (b.work_started_at && b.work_ended_at)
          ? Math.max(0, Math.floor((new Date(b.work_ended_at).getTime() - new Date(b.work_started_at).getTime())/1000))
          : 0
        if (!svcMap[nm]) svcMap[nm] = { name: nm, count: 0, income: 0, secs: 0 }
        svcMap[nm].count += 1
        svcMap[nm].income += (b.final_amount ?? 0)
        svcMap[nm].secs += secs
      }
      const serviceBreakdown = Object.values(svcMap).sort((a,b) => b.income - a.income)

      // full completed list (newest first) for the Jobs tab pagination
      const completedList: RecentJob[] = comp
        .slice()
        .sort((a: any, b: any) => new Date(b.work_ended_at ?? b.scheduled_at).getTime() - new Date(a.work_ended_at ?? a.scheduled_at).getTime())
        .map((b: any) => ({
          id: b.id ?? Math.random().toString(),
          service_name: b.services?.name ?? 'Service',
          area: b.addresses?.area ?? '—',
          status: b.status, final_amount: b.final_amount ?? 0, scheduled_at: b.scheduled_at,
          work_started_at: b.work_started_at ?? null, work_ended_at: b.work_ended_at ?? null,
        }))

      const wh = buildWorkHours(comp)
      return {
        id: u.id, full_name: u.full_name ?? 'Unknown', phone: u.phone ?? '—', email: u.email ?? '',
        is_active: u.is_active ?? true, is_available: w.is_available !== undefined ? w.is_available : true, is_verified: w.is_verified ?? false,
        is_busy: !!busy, current_service: busy?.service ?? null, work_started_at: busy?.work_started_at ?? null,
        joined_at: w.joined_at ?? null, created_at: u.created_at ?? null,
        schedule: w.schedule ?? null,
        worker_otp: w.worker_otp ?? null,
        totalOrders: wb.length, totalRevenue: rev, completed: comp.length,
        cancelled: wb.filter((b: any) => b.status === 'cancelled').length,
        pending:    wb.filter((b: any) => b.status === 'pending').length,
        inProgress: wb.filter((b: any) => b.status === 'in_progress').length,
        recentBookings,
        serviceBreakdown,
        completedList,
        ...wh,
      }
    }).sort((a, b) => b.totalRevenue - a.totalRevenue)

    setWorkers(list)
    // pending onboarding approvals (for the badge)
    try {
      const pr = await fetch('/api/worker-approval', { cache: 'no-store' })
      const pj = await pr.json()
      setPendingCount(pj.count ?? 0)
    } catch {}
    if (selected) { const updated = list.find(w => w.id === selected.id); if (updated) setSelected(updated) }
    // sync total_work_seconds to workers table for each worker
    for (const w of list) {
      if (w.totalWorkSecs > 0) {
        supabase.from('workers').upsert(
          { user_id: w.id, total_work_seconds: w.totalWorkSecs },
          { onConflict: 'user_id' }
        ).then(() => {})
      }
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function quickToggle(w: Worker, field: 'is_available'|'is_active') {
    setToggling(field)
    if (field === 'is_active') {
      await supabase.from('users').update({ is_active: !w.is_active }).eq('id', w.id)
      if (w.is_active) {
        // deactivating → mark unavailable too
        await supabase.from('workers').upsert({ user_id: w.id, is_available: false }, { onConflict: 'user_id' })
      }
    } else {
      // upsert so it works even if workers row doesn't exist yet
      await supabase.from('workers').upsert(
        { user_id: w.id, is_available: !w.is_available },
        { onConflict: 'user_id' }
      )
    }
    await load(); setToggling(null)
  }

  async function saveSchedule(workerId: string, sched: WeekSchedule) {
    // upsert so it works even if workers row doesn't exist yet
    await supabase.from('workers').upsert(
      { user_id: workerId, schedule: sched },
      { onConflict: 'user_id' }
    )
    await load()
  }

  // is worker truly available right now (schedule + is_available + not busy)?
  const isReallyAvailable = (w: Worker) => w.is_active && w.is_available && !w.is_busy && isWithinShift(w.schedule)

  const filtered   = workers.filter(w => w.full_name.toLowerCase().includes(search.toLowerCase()) || w.phone.includes(search))
  const busyCount  = workers.filter(w => w.is_busy).length
  const freeCount  = workers.filter(w => isReallyAvailable(w)).length
  const offShift   = workers.filter(w => w.is_active && w.is_available && !w.is_busy && !isWithinShift(w.schedule) && w.schedule).length
  const totalRev   = workers.reduce((s, w) => s + w.totalRevenue, 0)

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin border-slate-200" style={{ borderTopColor: '#0891B2' }}/>
        <p className="text-sm text-slate-400">Loading workers…</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen px-4 md:px-8 py-7 bg-slate-50">

      {/* header */}
      <div className="flex items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl"
            style={{ background: '#06B6D414', border: '1px solid #06B6D425' }}>👷</div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 leading-tight tracking-tight">Workers</h1>
            <p className="text-xs text-slate-400 font-medium">
              {workers.length} total · {busyCount} on job · {freeCount} free now
              {pendingCount > 0 && <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-black text-[10px]">✅ {pendingCount} pending approval{pendingCount > 1 ? 's' : ''}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input type="text" placeholder="Search name or phone…" value={search} onChange={e => setSearch(e.target.value)}
            className="px-4 py-2.5 rounded-xl text-sm text-slate-800 placeholder-slate-400 outline-none bg-white border border-slate-200 w-44 md:w-64"/>
          <button onClick={() => setDrawer('add')}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-white font-black text-sm active:scale-95 transition-all whitespace-nowrap"
            style={{ background: 'linear-gradient(135deg,#0891B2,#0E7490)', boxShadow: '0 4px 12px rgba(8,145,178,0.28)' }}>
            + Add
          </button>
        </div>
      </div>

      {/* KPI row — dense */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {[
          { label: 'Total Workers',  value: workers.length, accent: '#0891B2', icon: '👷' },
          { label: 'On Job Now',     value: busyCount,      accent: '#0891B2', icon: '⚡' },
          { label: 'Free in Shift',  value: freeCount,      accent: '#059669', icon: '🟢' },
          { label: 'Total Revenue',  value: `₹${totalRev > 99999 ? (totalRev/1000).toFixed(0)+'k' : totalRev.toLocaleString('en-IN')}`, accent: '#0E7490', icon: '💰' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-2xl border border-slate-200/80 p-5 hover:border-slate-300 hover:shadow-sm transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">{c.label}</span>
              <span className="w-6 h-6 rounded-md flex items-center justify-center text-sm" style={{ background: `${c.accent}14` }}>{c.icon}</span>
            </div>
            <p className="text-2xl font-black text-slate-900 leading-none">{c.value}</p>
          </div>
        ))}
      </div>

      {/* legend */}
      <div className="flex gap-4 mb-3 px-1 flex-wrap">
        {[['#D97706','On job'],['#059669','Free & in shift'],['#F97316','Off shift'],['#94A3B8','Unavailable'],['#DC2626','Inactive']].map(([c,l]) => (
          <div key={l} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: c }}/>
            <span className="text-[11px] text-slate-400">{l}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        <div className={`${selected ? 'hidden lg:block lg:w-1/2' : 'w-full'}`}>
          {filtered.length === 0
            ? (
              <div className="rounded-xl p-16 text-center bg-white border border-slate-200">
                <p className="text-4xl mb-3">👷</p>
                <p className="text-slate-700 font-bold">No workers found</p>
                <button onClick={() => setDrawer('add')} className="mt-4 px-6 py-2.5 rounded-xl text-white font-black text-sm" style={{ background: 'linear-gradient(135deg,#0891B2,#0E7490)' }}>+ Add First Worker</button>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/50">
                        {['Worker','Status','Verified','Jobs','Done','Revenue','OTP'].map(c => (
                          <th key={c} className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wide whitespace-nowrap">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((w, i) => {
                        const st = statusOf(w)
                        const avatarColors = ['#0891B2','#0E7490','#06B6D4','#0891B2','#155E75','#0E7490']
                        const avatarBg = avatarColors[i % avatarColors.length]
                        const isSel = selected?.id === w.id
                        return (
                          <tr key={w.id}
                            onClick={() => { setSelected(isSel ? null : w); setSelIndex(i) }}
                            className="border-b border-slate-50 last:border-0 hover:bg-slate-50/70 transition-colors cursor-pointer"
                            style={{ background: isSel ? `${avatarBg}08` : undefined }}>
                            {/* Worker */}
                            <td className="px-4 py-3.5">
                              <div className="flex items-center gap-2.5">
                                <div className="relative shrink-0">
                                  <div className="w-9 h-9 rounded-lg flex items-center justify-center font-black text-sm text-white"
                                    style={{ background: `linear-gradient(135deg,${avatarBg},${avatarBg}CC)`, opacity: w.is_active ? 1 : 0.5 }}>
                                    {w.full_name[0]?.toUpperCase()}
                                  </div>
                                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white" style={{ background: st.color }}/>
                                </div>
                                <div className="min-w-0">
                                  <p className="font-bold text-slate-800 text-[13px] truncate max-w-[150px]">{w.full_name}</p>
                                  <p className="text-[11px] text-slate-400">+91 {w.phone}</p>
                                </div>
                              </div>
                            </td>
                            {/* Status */}
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold">
                                <span className="w-2 h-2 rounded-full" style={{ background: st.color }}/>
                                <span style={{ color: st.color }}>{st.label}</span>
                                {w.is_busy && w.work_started_at && (
                                  <LiveTimer start={w.work_started_at} color="#D97706"/>
                                )}
                              </span>
                            </td>
                            {/* Verified */}
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              {w.is_verified
                                ? <span className="text-[11px] font-bold text-cyan-700">✓ Verified</span>
                                : <span className="text-[11px] text-slate-400">—</span>}
                            </td>
                            {/* Jobs */}
                            <td className="px-4 py-3.5 whitespace-nowrap text-[13px] font-semibold text-slate-700">{w.totalOrders}</td>
                            {/* Done */}
                            <td className="px-4 py-3.5 whitespace-nowrap text-[13px] font-semibold text-emerald-600">{w.completed}</td>
                            {/* Revenue */}
                            <td className="px-4 py-3.5 whitespace-nowrap text-[13px] font-black text-cyan-700">₹{w.totalRevenue.toLocaleString('en-IN')}</td>
                            {/* OTP */}
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              {w.worker_otp
                                ? <span className="font-mono font-bold text-[12px] text-violet-700">{w.worker_otp}</span>
                                : <span className="text-[11px] text-red-400">not set</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          }
        </div>

        {selected && (
          <div className="w-full lg:w-1/2 lg:sticky lg:top-6 lg:self-start">
            <WorkerDetail
              w={selected} index={selIndex}
              onClose={() => setSelected(null)}
              onEdit={() => setDrawer('edit')}
              onDelete={() => setToDelete(selected)}
              onToggle={(field) => quickToggle(selected, field)}
              onScheduleSave={saveSchedule}
              toggling={toggling}
              onReload={load}
            />
          </div>
        )}
      </div>

      {drawer && (
        <WorkerForm mode={drawer}
          init={drawer === 'edit' && selected
            ? { id: selected.id, full_name: selected.full_name, phone: selected.phone, email: selected.email, is_available: selected.is_available, is_verified: selected.is_verified, is_active: selected.is_active, worker_otp: selected.worker_otp ?? '' }
            : { ...EMPTY_WORKER }}
          onClose={() => setDrawer(null)}
          onSaved={() => { setDrawer(null); load() }}/>
      )}

      {toDelete && (
        <DeleteModal worker={toDelete} onClose={() => setToDelete(null)}
          onDone={() => { setToDelete(null); setSelected(null); load() }}/>
      )}
    </div>
  )
}