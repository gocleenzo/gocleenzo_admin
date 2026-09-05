'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Today's schedule entry for a worker — replaces the old recurring
// day-of-week WeekSchedule model. Sourced from worker_schedule_dates,
// scoped to just today's date (used for live status/shift display; the
// full multi-date calendar lives in ScheduleDateRequestTab).
type TodayEntry = {
  enabled: boolean
  start: string   // "09:00"
  end: string     // "17:00"
  breaks: { from: string; to: string }[]
}

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
  todaySchedule: TodayEntry | null
  worker_otp: string | null
  // Location tracking — reflects the worker app's device-level Location
  // toggle. The worker app now BLOCKS ITSELF entirely while location
  // services are off (LocationGate), so "location off" here also means
  // the worker literally cannot use the app at all right now — this
  // isn't just "app closed", it's a hard signal.
  locationUpdatedAt: string | null
  // work hours aggregates
  totalWorkSecs: number
  todayWorkSecs: number
  thisWeekWorkSecs: number
  thisMonthWorkSecs: number
  dailyHours: { date: string; secs: number }[]      // last 30 days
  weeklyHours: { week: string; secs: number }[]     // last 12 weeks
  monthlyHours: { month: string; secs: number }[]   // last 12 months
}

// A worker's location is considered "live" if it's been updated within
// this window — matches the same 2-minute freshness threshold used by
// the live map / coverage views, so a worker's status looks consistent
// everywhere in the admin app rather than using different thresholds
// in different places.
const LOCATION_STALE_MS = 2 * 60 * 1000;

function isLocationLive(updatedAt: string | null): boolean {
  if (!updatedAt) return false;
  return Date.now() - new Date(updatedAt).getTime() <= LOCATION_STALE_MS;
}

function locationAgoLabel(updatedAt: string | null): string {
  if (!updatedAt) return 'Never';
  const secs = Math.round((Date.now() - new Date(updatedAt).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

type ServiceStat = {
  name: string; count: number; income: number; secs: number
}

type RecentJob = {
  id: string; service_name: string; area: string; status: string
  final_amount: number; scheduled_at: string
  work_started_at: string | null; work_ended_at: string | null
}

const EMPTY_WORKER = { full_name: '', phone: '', email: '', is_available: true, worker_otp: '' }

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

function todayNetMins(entry: TodayEntry | null): number {
  if (!entry || !entry.enabled) return 0
  const total = timeToMins(entry.end) - timeToMins(entry.start)
  if (total <= 0) return 0
  const breakMins = entry.breaks.reduce((s, b) => {
    const bStart = Math.max(timeToMins(b.from), timeToMins(entry.start))
    const bEnd   = Math.min(timeToMins(b.to),   timeToMins(entry.end))
    return s + Math.max(0, bEnd - bStart)
  }, 0)
  return Math.max(0, total - breakMins)
}

// Is the worker currently within today's scheduled hours (and not on a
// break)? No entry for today = not scheduled = false (the admin hasn't
// appointed hours for this date via the calendar yet).
function isWorkingNow(entry: TodayEntry | null): boolean {
  if (!entry || !entry.enabled) return false
  const now = new Date()
  const nowMins = now.getHours() * 60 + now.getMinutes()
  if (nowMins < timeToMins(entry.start) || nowMins >= timeToMins(entry.end)) return false
  for (const b of entry.breaks) {
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

// ── Areas tab — assign this worker to pincodes ───────────────────
// A worker only becomes eligible for bookings in a pincode once
// they're explicitly assigned here (via worker_pincodes). Pincodes
// with zero assignments impose no restriction at all (see
// try_claim_slot) — so this tab is purely additive: assigning a
// worker to a pincode here is what actually turns pincode-based
// worker restriction "on" for that area. No map or drawing needed —
// just type the pincode(s) this worker covers.
function AreasTab({ workerId, supabase }: { workerId: string; supabase: any }) {
  const [pincodes, setPincodes] = useState<{ id: string; pincode: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [adding, setAdding] = useState(false)

  async function load() {
    setLoading(true); setErr(null)
    try {
      const { data, error } = await supabase
        .from('worker_pincodes')
        .select('id, pincode')
        .eq('worker_id', workerId)
        .order('pincode', { ascending: true })
      if (error) { setErr(error.message); setLoading(false); return }
      setPincodes(data ?? [])
    } catch (e: any) {
      setErr(e?.message ?? 'Could not load areas')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [workerId])

  function normalizePincode(raw: string): string | null {
    const trimmed = raw.trim()
    // Indian pincodes are 6 digits — reject anything else rather than
    // silently saving a malformed value that would never match a real
    // address's pincode.
    if (!/^\d{6}$/.test(trimmed)) return null
    return trimmed
  }

  async function addPincode() {
    const clean = normalizePincode(input)
    if (!clean) {
      setErr('Enter a valid 6-digit pincode')
      return
    }
    if (pincodes.some(p => p.pincode === clean)) {
      setErr('This pincode is already assigned to this worker')
      return
    }
    setAdding(true); setErr(null)
    try {
      const { data, error } = await supabase
        .from('worker_pincodes')
        .insert({ worker_id: workerId, pincode: clean })
        .select('id, pincode')
        .single()
      if (error) { setErr(error.message); setAdding(false); return }
      setPincodes(prev => [...prev, data].sort((a, b) => a.pincode.localeCompare(b.pincode)))
      setInput('')
    } catch (e: any) {
      setErr(e?.message ?? 'Could not add pincode')
    } finally {
      setAdding(false)
    }
  }

  async function removePincode(id: string) {
    setBusy(id); setErr(null)
    try {
      const { error } = await supabase.from('worker_pincodes').delete().eq('id', id)
      if (error) { setErr(error.message); setBusy(null); return }
      setPincodes(prev => prev.filter(p => p.id !== id))
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Loading areas…</div>

  return (
    <div className="p-5 space-y-4">
      <div className="rounded-xl bg-cyan-50 border border-cyan-200 px-3 py-2.5">
        <p className="text-[11px] text-cyan-700 font-semibold">
          📍 A worker only receives bookings from a pincode once assigned here.
          Pincodes with no workers assigned are unrestricted — every available
          worker remains eligible until you assign someone specific.
        </p>
      </div>

      {err && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3">
          <p className="text-sm font-bold text-red-700">{err}</p>
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={e => { if (e.key === 'Enter') addPincode() }}
          placeholder="e.g. 400056"
          inputMode="numeric"
          maxLength={6}
          className="flex-1 px-4 py-2.5 rounded-xl text-sm font-mono font-bold text-slate-800 outline-none bg-white border border-slate-200 placeholder-slate-300 focus:border-cyan-400"
        />
        <button
          onClick={addPincode}
          disabled={adding || input.length !== 6}
          className="px-5 py-2.5 rounded-xl text-sm font-black text-white disabled:opacity-40"
          style={{ background: '#0891B2' }}
        >
          {adding ? '…' : '+ Add'}
        </button>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">
          Assigned pincodes ({pincodes.length})
        </p>
      </div>

      {pincodes.length === 0 ? (
        <div className="p-8 text-center rounded-xl border border-slate-200">
          <p className="text-3xl mb-2">📍</p>
          <p className="text-slate-600 font-bold text-sm">No pincodes assigned yet</p>
          <p className="text-[11px] text-slate-400 mt-1">This worker is eligible for every unrestricted pincode until you add one above.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
          {pincodes.map(p => (
            <div key={p.id} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-mono font-bold text-slate-800">{p.pincode}</span>
              <button
                disabled={busy === p.id}
                onClick={() => removePincode(p.id)}
                className="text-slate-400 hover:text-red-600 text-sm px-2 disabled:opacity-50"
              >
                {busy === p.id ? '…' : '✕ Remove'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════
// PAY RATES TAB — per-worker base/order/overtime hourly rate
// overrides. Reads/writes worker_pay_rates directly via Supabase —
// no API route needed, matching the pattern AreasTab already uses
// in this file. Any field left blank uses the system default rate
// (shown as placeholder text) rather than forcing every worker to
// have every rate explicitly set.
// ═══════════════════════════════════════════════════════════════

// Mirrors the SQL fallbacks in cleenzo_rate_base_per_hour() (₹50),
// cleenzo_rate_order_per_hour() (₹32), cleenzo_rate_overtime_per_hour()
// (₹0) — shown as placeholder text so the admin can see what rate is
// currently in effect even when this worker has no override set.
const DEFAULT_RATES = {
  base: 50,
  order: 32,
  overtime: 0,
}

function PayRatesTab({ workerId, supabase }: { workerId: string; supabase: any }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Empty string = "no override, use default" — kept distinct from '0'
  // (an admin might deliberately want ₹0/hr for one of these, e.g. to
  // pause order incentive for a specific worker without deleting the row).
  const [baseRate, setBaseRate] = useState('')
  const [orderRate, setOrderRate] = useState('')
  const [overtimeRate, setOvertimeRate] = useState('')
  const [hasRow, setHasRow] = useState(false)

  async function load() {
    setLoading(true); setErr(null)
    try {
      const { data, error } = await supabase
        .from('worker_pay_rates')
        .select('base_rate_per_hour, order_rate_per_hour, overtime_rate_per_hour')
        .eq('worker_id', workerId)
        .maybeSingle()
      if (error) { setErr(error.message); setLoading(false); return }
      if (data) {
        setHasRow(true)
        setBaseRate(data.base_rate_per_hour != null ? String(data.base_rate_per_hour) : '')
        setOrderRate(data.order_rate_per_hour != null ? String(data.order_rate_per_hour) : '')
        setOvertimeRate(data.overtime_rate_per_hour != null ? String(data.overtime_rate_per_hour) : '')
      } else {
        setHasRow(false)
        setBaseRate(''); setOrderRate(''); setOvertimeRate('')
      }
    } catch (e: any) {
      setErr(e?.message ?? 'Could not load pay rates')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [workerId])

  function parseRateInput(v: string): number | null {
    const t = v.trim()
    if (t === '') return null // explicit "use default"
    const n = Number(t)
    return Number.isFinite(n) && n >= 0 ? n : NaN
  }

  async function save() {
    const base = parseRateInput(baseRate)
    const order = parseRateInput(orderRate)
    const overtime = parseRateInput(overtimeRate)
    if (Number.isNaN(base) || Number.isNaN(order) || Number.isNaN(overtime)) {
      setErr('Rates must be non-negative numbers, or left blank to use the default.')
      return
    }
    setSaving(true); setErr(null); setSaved(false)
    try {
      const { error } = await supabase.from('worker_pay_rates').upsert({
        worker_id: workerId,
        base_rate_per_hour: base,
        order_rate_per_hour: order,
        overtime_rate_per_hour: overtime,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'worker_id' })
      if (error) { setErr(error.message); setSaving(false); return }
      setHasRow(true)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e: any) {
      setErr(e?.message ?? 'Could not save pay rates')
    } finally {
      setSaving(false)
    }
  }

  async function resetToDefaults() {
    setSaving(true); setErr(null); setSaved(false)
    try {
      const { error } = await supabase.from('worker_pay_rates').delete().eq('worker_id', workerId)
      if (error) { setErr(error.message); setSaving(false); return }
      setHasRow(false)
      setBaseRate(''); setOrderRate(''); setOvertimeRate('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Loading pay rates…</div>

  const rateField = (
    label: string,
    value: string,
    setValue: (v: string) => void,
    defaultVal: number,
    hint: string,
    color: string,
  ) => (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-black text-slate-800">{label}</p>
        <span className="text-[10px] font-bold text-slate-400">Default: ₹{defaultVal}/hr</span>
      </div>
      <p className="text-[11px] text-slate-400 mb-2">{hint}</p>
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-slate-400">₹</span>
        <input
          type="number" min={0} step="0.5"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={String(defaultVal)}
          className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm font-black outline-none focus:border-current"
          style={{ color }}
        />
        <span className="text-xs text-slate-400">/hr</span>
      </div>
    </div>
  )

  return (
    <div className="p-5 space-y-4">
      <div className="rounded-xl bg-violet-50 border border-violet-200 px-3 py-2.5">
        <p className="text-[11px] text-violet-700 font-semibold">
          ⚙️ Custom rates for this worker only. Leave a field blank to use the
          platform default shown next to it. These rates apply to all future
          earnings calculations for this worker — past payout requests are
          unaffected.
        </p>
      </div>

      {err && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3">
          <p className="text-sm font-bold text-red-700">{err}</p>
        </div>
      )}

      {rateField('Base pay rate', baseRate, setBaseRate, DEFAULT_RATES.base,
        'Paid per scheduled hour, regardless of orders completed.', '#2563EB')}

      {rateField('Order incentive rate', orderRate, setOrderRate, DEFAULT_RATES.order,
        'Additional pay per scheduled hour, on top of base pay.', '#0891B2')}

      {rateField('Overtime bonus rate', overtimeRate, setOvertimeRate, DEFAULT_RATES.overtime,
        "Paid per hour worked BEYOND this worker's scheduled hours that day — automatically covers both a shift running long and any customer-paid Extra Time. Default is ₹0 (no bonus) until set here.", '#D97706')}

      {saved && (
        <div className="rounded-xl bg-green-50 border border-green-200 px-3 py-2">
          <p className="text-xs font-bold text-green-700">✓ Saved</p>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={save} disabled={saving}
          className="flex-1 py-3 rounded-xl font-black text-white text-sm disabled:opacity-40"
          style={{ background: '#0891B2' }}>
          {saving ? 'Saving…' : 'Save rates'}
        </button>
        {hasRow && (
          <button onClick={resetToDefaults} disabled={saving}
            className="px-4 py-3 rounded-xl font-bold text-slate-600 text-sm bg-slate-100 disabled:opacity-40">
            Reset to defaults
          </button>
        )}
      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════
// ScheduleDateRequestTab — worker-initiated DATE-SPECIFIC schedule requests
// Reads/writes worker_schedule_date_requests + worker_schedule_dates
// directly via Supabase (no dependency on a server API route).
//
// UI: a date-strip selector + a single detail card for whichever date is
// selected — mirrors the worker app's pattern (one date's info visible at
// a time) instead of a horizontal scroll of every date's compact card.
// ═══════════════════════════════════════════════════════════════════

type DateEntry = {
  date: string; enabled: boolean; start: string; end: string
  breaks: { from: string; to: string }[]
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
function dateEntryNet(e: DateEntry | undefined): number {
  if (!e || e.enabled !== true) return 0
  const s = schedToMins(e.start), en = schedToMins(e.end)
  let total = en - s
  if (total <= 0) return 0
  for (const b of (e.breaks ?? [])) {
    const bs = Math.max(schedToMins(b.from), s)
    const be = Math.min(schedToMins(b.to), en)
    total -= Math.max(0, be - bs)
  }
  return Math.max(0, total)
}
function fmtDateShort(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  return {
    day: d.getDate(),
    month: d.toLocaleDateString('en-IN', { month: 'short' }),
    weekday: d.toLocaleDateString('en-IN', { weekday: 'short' }),
  }
}
function fmtTime(t: string) {
  const mins = schedToMins(t)
  const h24 = Math.floor(mins / 60), m = mins % 60
  const pm = h24 >= 12
  let h12 = h24 % 12; if (h12 === 0) h12 = 12
  return `${h12}:${String(m).padStart(2, '0')} ${pm ? 'PM' : 'AM'}`
}

function ScheduleDateRequestTab({ workerId, supabase, onChanged }: {
  workerId: string; supabase: any; onChanged: () => void
}) {
  const [liveDates, setLiveDates] = useState<DateEntry[]>([])
  const [request, setRequest] = useState<any>(null)
  const [history, setHistory] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pendingSelected, setPendingSelected] = useState<string | null>(null)

  // ── Admin "appoint schedule" calendar state ──
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set())
  const [editEnabled, setEditEnabled] = useState(true)
  const [editStart, setEditStart] = useState('09:00')
  const [editEnd, setEditEnd] = useState('17:00')
  const [editBreakOn, setEditBreakOn] = useState(false)
  const [editBreakFrom, setEditBreakFrom] = useState('13:00')
  const [calSaving, setCalSaving] = useState(false)

  async function load() {
    setLoading(true); setErr(null)
    try {
      const todayStr = new Date().toISOString().slice(0, 10)
      const [{ data: liveRows }, { data: reqRows }] = await Promise.all([
        supabase.from('worker_schedule_dates')
          .select('date, enabled, start_time, end_time, breaks')
          .eq('worker_id', workerId)
          .gte('date', todayStr)
          .order('date', { ascending: true }),
        supabase.from('worker_schedule_date_requests')
          .select('id, dates, status, net_total_mins, note, reject_reason, requested_at, reviewed_at')
          .eq('worker_id', workerId)
          .order('requested_at', { ascending: false })
          .limit(10),
      ])
      const live: DateEntry[] = (liveRows ?? []).map((r: any) => ({
        date: r.date, enabled: r.enabled === true,
        start: r.start_time ?? '09:00', end: r.end_time ?? '17:00',
        breaks: r.breaks ?? [],
      }))
      const all = reqRows ?? []
      const pending = all.find((r: any) => r.status === 'pending') ?? null
      const past = all.filter((r: any) => r.status !== 'pending')
      setLiveDates(live)
      setRequest(pending)
      setHistory(past)
      const pendingEntries: DateEntry[] = pending?.dates ?? []
      setPendingSelected(prev => prev && pendingEntries.some((e: DateEntry) => e.date === prev) ? prev : (pendingEntries[0]?.date ?? null))
    } catch {
      setLiveDates([]); setRequest(null); setHistory([])
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [workerId])

  async function act(action: 'approve' | 'reject') {
    if (!request) return
    let reason: string | undefined
    if (action === 'reject') {
      const r = window.prompt('Reason for rejection (the worker will see this):')
      if (r === null) return
      reason = r
    }
    setBusy(true); setErr(null)
    try {
      if (action === 'approve') {
        const entries: DateEntry[] = request.dates ?? []
        // Write every date in the batch — including disabled ones — so a
        // day the worker turned off is recorded as off, not just absent.
        // This is the actual persistence step: proposed dates become the
        // live, queryable schedule in worker_schedule_dates.
        const rows = entries.map(e => ({
          worker_id: workerId,
          date: e.date,
          enabled: e.enabled === true,
          start_time: e.start,
          end_time: e.end,
          breaks: e.breaks ?? [],
          updated_at: new Date().toISOString(),
        }))
        if (rows.length > 0) {
          const { error } = await supabase.from('worker_schedule_dates')
            .upsert(rows, { onConflict: 'worker_id,date' })
          if (error) { setErr(error.message); setBusy(false); return }
        }
        await supabase.from('worker_schedule_date_requests')
          .update({ status: 'approved', reviewed_at: new Date().toISOString() })
          .eq('id', request.id)
      } else {
        await supabase.from('worker_schedule_date_requests')
          .update({ status: 'rejected', reject_reason: reason, reviewed_at: new Date().toISOString() })
          .eq('id', request.id)
      }
      await load()
      onChanged()
    } catch (e: any) {
      setErr(e?.message ?? 'Action failed')
    } finally { setBusy(false) }
  }

  // ── Admin "appoint schedule" calendar helpers ──
  function dateKeyOf(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  function addMinsToTime(t: string, mins: number): string {
    const total = schedToMins(t) + mins
    const h = Math.floor(total / 60) % 24, m = total % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  function monthGrid(monthDate: Date): (Date | null)[][] {
    const year = monthDate.getFullYear(), month = monthDate.getMonth()
    const startWeekday = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const cells: (Date | null)[] = []
    for (let i = 0; i < startWeekday; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
    while (cells.length % 7 !== 0) cells.push(null)
    const weeks: (Date | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
    return weeks
  }

  const todayStart = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d })()

  function toggleDateSelect(key: string, entry: DateEntry | undefined) {
    setSelectedDates(prev => {
      const next = new Set(prev)
      if (next.has(key)) { next.delete(key); return next }
      next.add(key)
      // If this is the only selection and it already has a live entry,
      // pre-fill the editor from it for convenience.
      if (next.size === 1 && entry) {
        setEditEnabled(entry.enabled)
        setEditStart(entry.start)
        setEditEnd(entry.end)
        if (entry.breaks.length > 0) {
          setEditBreakOn(true)
          setEditBreakFrom(entry.breaks[0].from)
        } else {
          setEditBreakOn(false)
        }
      }
      return next
    })
  }

  function selectAllWeekdayInMonth(weekday: number) {
    const weeks = monthGrid(calMonth)
    setSelectedDates(prev => {
      const next = new Set(prev)
      for (const week of weeks) {
        for (const d of week) {
          if (!d || d < todayStart) continue
          if (d.getDay() === weekday) next.add(dateKeyOf(d))
        }
      }
      return next
    })
  }

  async function saveSelectedDates() {
    if (selectedDates.size === 0) return
    setCalSaving(true); setErr(null)
    try {
      const breaks = editEnabled && editBreakOn
        ? [{ from: editBreakFrom, to: addMinsToTime(editBreakFrom, 15) }]
        : []
      const rows = Array.from(selectedDates).map(date => ({
        worker_id: workerId,
        date,
        enabled: editEnabled,
        start_time: editStart,
        end_time: editEnd,
        breaks,
        updated_at: new Date().toISOString(),
      }))
      const { error } = await supabase.from('worker_schedule_dates')
        .upsert(rows, { onConflict: 'worker_id,date' })
      if (error) { setErr(error.message); setCalSaving(false); return }
      setSelectedDates(new Set())
      await load()
      onChanged()
    } catch (e: any) {
      setErr(e?.message ?? 'Could not save schedule')
    } finally { setCalSaving(false) }
  }

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Loading schedule…</div>

  const pendingEntries: DateEntry[] = request?.dates ?? []
  const liveByDate: Record<string, DateEntry> = {}
  liveDates.forEach(e => { liveByDate[e.date] = e })
  // Workers can now only request BREAK changes — enabled/start/end in a
  // request always mirror the live schedule. Only show the dates whose
  // break actually differs, so the admin sees "1 break change" instead of
  // all 14 window dates looking like a full schedule resubmission.
  function breaksDiffer(a: DateEntry, b: DateEntry | undefined): boolean {
    const ab = a.breaks ?? []
    const bb = b?.breaks ?? []
    if (ab.length !== bb.length) return true
    if (ab.length === 0) return false
    return ab[0].from !== bb[0].from || ab[0].to !== bb[0].to
  }
  const changedEntries = pendingEntries.filter(e => breaksDiffer(e, liveByDate[e.date]))
  const pendingEntry = changedEntries.find(e => e.date === pendingSelected) ?? changedEntries[0]
  const calWeeks = monthGrid(calMonth)
  const WEEKDAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

  return (
    <div className="p-5 space-y-4">
      <div className="rounded-xl bg-blue-50 border border-blue-200 px-3 py-2.5">
        <p className="text-[11px] text-blue-700 font-semibold">
          📅 Date-specific schedule — each date is independent, no repeating weekly pattern.
        </p>
      </div>

      {err && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3">
          <p className="text-sm font-bold text-red-700">{err}</p>
        </div>
      )}

      {/* ── Appoint schedule: admin calendar ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">
            Appoint schedule
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
              className="w-6 h-6 rounded-lg flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-slate-200 text-xs">‹</button>
            <span className="text-xs font-bold text-slate-700 w-24 text-center">
              {calMonth.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
            </span>
            <button onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
              className="w-6 h-6 rounded-lg flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-slate-200 text-xs">›</button>
          </div>
        </div>

        {/* quick weekday bulk-select */}
        <div className="flex gap-1 mb-2">
          {WEEKDAY_LABELS.map((label, wi) => (
            <button key={label} onClick={() => selectAllWeekdayInMonth(wi)}
              title={`Select all ${label}s this month`}
              className="flex-1 py-1 rounded-md text-[10px] font-bold bg-slate-50 border border-slate-200 text-slate-500 hover:bg-cyan-50 hover:border-cyan-200 hover:text-cyan-700 transition-all">
              {label}
            </button>
          ))}
        </div>

        {/* calendar grid */}
        <div className="rounded-xl border border-slate-200 p-2 bg-white">
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAY_LABELS.map(l => (
              <p key={l} className="text-[9px] font-black text-slate-400 text-center">{l}</p>
            ))}
          </div>
          <div className="space-y-1">
            {calWeeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-1">
                {week.map((d, di) => {
                  if (!d) return <div key={di} />
                  const key = dateKeyOf(d)
                  const entry = liveByDate[key]
                  const isPast = d < todayStart
                  const isSel = selectedDates.has(key)
                  const isToday = key === dateKeyOf(new Date())
                  return (
                    <button key={di} disabled={isPast}
                      onClick={() => toggleDateSelect(key, entry)}
                      className="aspect-square rounded-lg border flex flex-col items-center justify-center transition-all disabled:cursor-not-allowed"
                      style={{
                        background: isSel ? '#0891B2' : entry?.enabled ? '#ECFEFF' : entry ? '#F8FAFC' : '#fff',
                        borderColor: isSel ? 'transparent' : isToday ? '#0891B2' : entry?.enabled ? '#A5F3FC' : '#E2E8F0',
                        borderWidth: isToday && !isSel ? 2 : 1,
                        opacity: isPast ? 0.35 : 1,
                      }}>
                      <span className="text-[11px] font-bold" style={{ color: isSel ? '#fff' : '#334155' }}>{d.getDate()}</span>
                      {entry && (
                        <span className="text-[7px] font-black mt-0.5"
                          style={{ color: isSel ? 'rgba(255,255,255,0.9)' : entry.enabled ? '#059669' : '#94a3b8' }}>
                          {entry.enabled ? schedLabel(dateEntryNet(entry)) : 'Off'}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* editor panel — appears once at least one date is selected */}
        {selectedDates.size > 0 && (
          <div className="mt-3 rounded-xl border-2 border-cyan-200 bg-cyan-50/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-black text-cyan-800">
                {selectedDates.size} date{selectedDates.size > 1 ? 's' : ''} selected
              </p>
              <button onClick={() => setSelectedDates(new Set())}
                className="text-[11px] font-bold text-slate-400 hover:text-slate-600">Clear</button>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setEditEnabled(true)}
                className="flex-1 py-2 rounded-lg text-xs font-black transition-all"
                style={{ background: editEnabled ? '#0891B2' : '#fff', color: editEnabled ? '#fff' : '#64748b', border: '1px solid #CBD5E1' }}>
                Working
              </button>
              <button onClick={() => setEditEnabled(false)}
                className="flex-1 py-2 rounded-lg text-xs font-black transition-all"
                style={{ background: !editEnabled ? '#64748b' : '#fff', color: !editEnabled ? '#fff' : '#64748b', border: '1px solid #CBD5E1' }}>
                Day off
              </button>
            </div>

            {editEnabled && (
              <>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <p className="text-[10px] text-slate-500 mb-1">Start</p>
                    <input type="time" value={editStart} onChange={e => setEditStart(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg text-xs font-bold text-slate-700 bg-white border border-slate-200 outline-none" />
                  </div>
                  <div className="flex-1">
                    <p className="text-[10px] text-slate-500 mb-1">End</p>
                    <input type="time" value={editEnd} onChange={e => setEditEnd(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg text-xs font-bold text-slate-700 bg-white border border-slate-200 outline-none" />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={editBreakOn} onChange={e => setEditBreakOn(e.target.checked)} />
                  15-min break starting at
                  {editBreakOn && (
                    <input type="time" value={editBreakFrom} onChange={e => setEditBreakFrom(e.target.value)}
                      className="px-2 py-1 rounded-lg text-xs font-bold text-slate-700 bg-white border border-slate-200 outline-none" />
                  )}
                </label>
              </>
            )}

            <button onClick={saveSelectedDates} disabled={calSaving}
              className="w-full py-2.5 rounded-xl font-black text-white text-sm disabled:opacity-40"
              style={{ background: '#16a34a' }}>
              {calSaving ? 'Saving…' : `Save schedule for ${selectedDates.size} date${selectedDates.size > 1 ? 's' : ''}`}
            </button>
          </div>
        )}
      </div>

      {/* ── Pending break request ── */}
      {request ? (
        <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: '#FCD34D' }}>
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
            <div>
              <p className="text-xs font-black text-amber-800">⏳ Pending break request</p>
              <p className="text-[11px] text-amber-700 mt-0.5">
                {changedEntries.length === 0
                  ? 'No break change detected'
                  : `Requesting a break change on ${changedEntries.length} date${changedEntries.length === 1 ? '' : 's'}`}
              </p>
            </div>
            <p className="text-[11px] text-slate-500">
              {new Date(request.requested_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </p>
          </div>

          <div className="p-4 space-y-3">
            {changedEntries.length > 0 ? (
              <>
                <DateStrip entries={changedEntries} selected={pendingSelected} onSelect={setPendingSelected} highlight />
                {pendingEntry && <DateDetailCard entry={pendingEntry} highlight />}
              </>
            ) : (
              <div className="rounded-xl border border-slate-200 p-4 text-center">
                <p className="text-sm text-slate-400">
                  This request doesn&apos;t change anything from the current live schedule.
                </p>
              </div>
            )}

            {request.note && (
              <p className="text-[12px] text-slate-600 italic">Note: {request.note}</p>
            )}

            <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
              <p className="text-[11px] text-slate-500">
                ⓘ Working hours are unaffected by this request — only the break time is
                changing. Double-check this worker doesn&apos;t already have a booking
                during the new break time before approving.
              </p>
            </div>

            <div className="flex gap-2 pt-1">
              <button disabled={busy} onClick={() => act('reject')}
                className="flex-1 py-2.5 rounded-xl font-bold text-white text-sm disabled:opacity-40"
                style={{ background: '#dc2626' }}>
                {busy ? '…' : 'Reject'}
              </button>
              <button disabled={busy} onClick={() => act('approve')}
                className="flex-1 py-2.5 rounded-xl font-bold text-white text-sm disabled:opacity-40"
                style={{ background: '#16a34a' }}>
                {busy ? '…' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 p-4 text-center">
          <p className="text-sm text-slate-500 font-semibold">No pending request</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            The worker can propose new dates from their app.
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
                    {schedLabel(r.net_total_mins ?? 0)} · {(r.dates ?? []).length} date{(r.dates ?? []).length === 1 ? '' : 's'}
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

/// Horizontally scrollable date-strip selector — tap a date to view its
/// detail below. Mirrors the worker app's date-strip pattern.
function DateStrip({ entries, selected, onSelect, highlight }: {
  entries: DateEntry[]; selected: string | null; onSelect: (date: string) => void; highlight?: boolean
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {entries.map(e => {
        const isSel = e.date === selected
        const { day, month, weekday } = fmtDateShort(e.date)
        const activeBg = highlight ? '#F59E0B' : '#0891B2'
        return (
          <button key={e.date} onClick={() => onSelect(e.date)}
            className="rounded-xl p-2 text-center border flex-shrink-0 transition-all"
            style={{
              width: 64,
              background: isSel ? activeBg : (e.enabled ? (highlight ? '#FFFBEB' : '#ECFEFF') : '#F8FAFC'),
              borderColor: isSel ? 'transparent' : (e.enabled ? (highlight ? '#FDE68A' : '#A5F3FC') : '#F1F5F9'),
            }}>
            <p className="text-[9px] font-black" style={{ color: isSel ? '#fff' : '#94a3b8' }}>{weekday}</p>
            <p className="text-[11px] font-black mt-0.5" style={{ color: isSel ? '#fff' : '#334155' }}>{day} {month}</p>
            <p className="text-[9px] font-bold mt-0.5"
              style={{ color: isSel ? 'rgba(255,255,255,0.85)' : (e.enabled ? '#059669' : '#94a3b8') }}>
              {e.enabled ? schedLabel(dateEntryNet(e)) : 'Off'}
            </p>
          </button>
        )
      })}
    </div>
  )
}

/// Full detail for the single selected date — hours, break, net total.
function DateDetailCard({ entry, highlight }: { entry: DateEntry; highlight?: boolean }) {
  const d = new Date(entry.date + 'T00:00:00')
  const fullWeekday = d.toLocaleDateString('en-IN', { weekday: 'long' })
  const fullDate = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })

  return (
    <div className="rounded-xl border p-4"
      style={{ borderColor: highlight ? '#FDE68A' : '#E2E8F0', background: highlight ? '#FFFBEB' : '#fff' }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-black text-slate-800">{fullWeekday}</p>
          <p className="text-xs text-slate-400">{fullDate}</p>
        </div>
        <span className="text-xs font-black px-2.5 py-1 rounded-full"
          style={{ background: entry.enabled ? '#DCFCE7' : '#F1F5F9', color: entry.enabled ? '#15803D' : '#94A3B8' }}>
          {entry.enabled ? 'Working' : 'Off'}
        </span>
      </div>
      {entry.enabled ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400 w-12">Hours</span>
            <span className="text-sm font-black text-cyan-700">{fmtTime(entry.start)} – {fmtTime(entry.end)}</span>
            <span className="text-[11px] font-bold text-slate-400">({schedLabel(dateEntryNet(entry))})</span>
          </div>
          {entry.breaks.length > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400 w-12">Break</span>
              <span className="text-sm font-bold text-amber-600">
                {fmtTime(entry.breaks[0].from)} – {fmtTime(entry.breaks[0].to)}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400 w-12">Break</span>
              <span className="text-sm text-slate-400">None</span>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-400">No shift scheduled this day</p>
      )}
    </div>
  )
}


// ── Worker Detail Panel ─────────────────────────────────────────
function WorkerDetail({ w, index, onClose, onEdit, onDelete, onToggle, toggling, onReload }: {
  w: Worker; index: number; onClose: () => void
  onEdit: () => void; onDelete: () => void
  onToggle: (field: 'is_available'|'is_active') => void
  toggling: string | null
  onReload: () => void
}) {
  const avatarColors = ['#0891B2','#0E7490','#06B6D4','#0891B2','#155E75','#0E7490']
  const avatarBg     = avatarColors[index % avatarColors.length]
  const completionRate = w.totalOrders > 0 ? Math.round((w.completed / w.totalOrders) * 100) : 0
  const inShift      = isWorkingNow(w.todaySchedule)
  const todayMins    = todayNetMins(w.todaySchedule)
  const st           = statusOf(w)

  const [tab, setTab]             = useState<'overview'|'approval'|'schedreq'|'hours'|'jobs'|'areas'|'payrates'|'payouts'|'earnings'|'referrals'|'tier'|'sos'>('overview')
  const [jobsShown, setJobsShown] = useState(10)

  useEffect(() => {
    setTab('overview')
    setJobsShown(10)
  }, [w.id])

  const TABS = [
    { key: 'overview' as const, label: 'Overview', icon: '▦' },
    { key: 'approval' as const, label: 'Approval & KYC', icon: '✅' },
    { key: 'schedreq' as const, label: 'Schedule', icon: '🗓' },
    { key: 'hours'    as const, label: 'Hours',    icon: '⏱' },
    { key: 'jobs'     as const, label: 'Jobs',     icon: '≡' },
    { key: 'areas'    as const, label: 'Areas',    icon: '📍' },
    { key: 'payrates' as const, label: 'Pay Rates', icon: '⚙️' },
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
              {isLocationLive(w.locationUpdatedAt) ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"/>📍 Location On
                </span>
              ) : (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">
                  📍 Location Off · {locationAgoLabel(w.locationUpdatedAt)}
                </span>
              )}
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
      <div className="flex gap-1 px-4 pt-3 border-b border-slate-100 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="relative px-3 py-2 text-xs font-bold transition-colors flex-shrink-0 whitespace-nowrap"
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
                { label: 'Today\'s Hrs',value: todayMins > 0 ? minsToLabel(todayMins) : '—', accent: '#D97706' },
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

        {/* ── SCHEDULE REQUEST TAB (worker-initiated schedule change requests) ── */}
        {tab === 'schedreq' && <ScheduleDateRequestTab workerId={w.id} supabase={createClient()} onChanged={onReload} />}

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
        {tab === 'areas' && <AreasTab workerId={w.id} supabase={createClient()} />}
        {tab === 'payrates' && <PayRatesTab workerId={w.id} supabase={createClient()} />}
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
  const inShift = isWorkingNow(w.todaySchedule)
  if (!w.is_active)                       return { color: '#DC2626', label: 'Inactive' }
  if (w.is_busy)                          return { color: '#D97706', label: 'On job' }
  if (w.is_available && inShift)          return { color: '#059669', label: 'Free' }
  if (w.is_available && !inShift && w.todaySchedule) return { color: '#F97316', label: 'Off shift' }
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
    const todayStr = (() => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })()
    const [{ data: users }, { data: wRows }, { data: bkng }, { data: active }, { data: todayRows }] = await Promise.all([
      supabase.from('users').select('id,full_name,phone,email,created_at,is_active').eq('role','worker'),
      supabase.from('workers').select('user_id,is_available,is_verified,joined_at,worker_otp,location_updated_at'),
      supabase.from('bookings').select('worker_id,status,final_amount,scheduled_at,work_started_at,work_ended_at,work_duration_seconds,service_duration_minutes,extra_time_mins,booking_duration_minutes,services(name,duration_minutes),addresses(area)').order('created_at', { ascending: false }),
      supabase.from('bookings').select('worker_id,work_started_at,services(name)').eq('status','in_progress'),
      supabase.from('worker_schedule_dates').select('worker_id,enabled,start_time,end_time,breaks').eq('date', todayStr),
    ]) as any[]
    const wMap: Record<string,any> = {}
    ;(wRows ?? []).forEach((w: any) => { wMap[w.user_id] = w })
    const todayMap: Record<string, TodayEntry> = {}
    ;(todayRows ?? []).forEach((r: any) => {
      todayMap[r.worker_id] = {
        enabled: r.enabled === true,
        start: r.start_time ?? '09:00',
        end: r.end_time ?? '17:00',
        breaks: r.breaks ?? [],
      }
    })
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
        todaySchedule: todayMap[u.id] ?? null,
        worker_otp: w.worker_otp ?? null,
        locationUpdatedAt: w.location_updated_at ?? null,
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

  // is worker truly available right now (today's schedule + is_available + not busy)?
  const isReallyAvailable = (w: Worker) => w.is_active && w.is_available && !w.is_busy && isWorkingNow(w.todaySchedule)

  const filtered   = workers.filter(w => w.full_name.toLowerCase().includes(search.toLowerCase()) || w.phone.includes(search))
  const busyCount  = workers.filter(w => w.is_busy).length
  const freeCount  = workers.filter(w => isReallyAvailable(w)).length
  const offShift   = workers.filter(w => w.is_active && w.is_available && !w.is_busy && !isWorkingNow(w.todaySchedule) && w.todaySchedule).length
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
                        {['Worker','Status','Location','Verified','Jobs','Done','Revenue','OTP'].map(c => (
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
                            {/* Location */}
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              {isLocationLive(w.locationUpdatedAt) ? (
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700">
                                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"/>
                                  📍 On
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-red-500">
                                  <span className="w-2 h-2 rounded-full bg-red-400"/>
                                  Off · {locationAgoLabel(w.locationUpdatedAt)}
                                </span>
                              )}
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