'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import SosWatcher from './sos_watcher'
import { loadStaffScope, pinInScope, workerInScope } from './_lib/staff_scope'
import './admin-responsive.css'

const NAV = [
  { href: '/admin-overview',   emoji: '📊', label: 'Overview',   color: '#2563EB' },
  { href: '/admin-bookings',   emoji: '📋', label: 'Bookings',   color: '#7C3AED' },
  { href: '/admin-recurring',  emoji: '🔁', label: 'Recurring',  color: '#7C3AED' },
  { href: '/admin-workers',    emoji: '👷', label: 'Workers',    color: '#0891B2' },
  { href: '/admin-users',      emoji: '👥', label: 'Users',      color: '#4F46E5' },
  { href: '/admin-services',   emoji: '🧾', label: 'Services',   color: '#0891B2' },
  { href: '/admin-live-map',   emoji: '📍', label: 'Live Map',   color: '#0D9488' },
  { href: '/admin-coverage',   emoji: '🛰️', label: 'Coverage',   color: '#0891B2' },
  { href: '/admin-slots',      emoji: '🗓️', label: 'Slots',      color: '#0891B2' },
  { href: '/admin-notifications', emoji: '🔔', label: 'Notifications', color: '#DB2777' },
  { href: '/admin-service-coverage', emoji: '🗺️', label: 'Service Coverage', color: '#0891B2' },
  { href: '/admin-reports',    emoji: '📈', label: 'Reports',    color: '#059669' },
  { href: '/admin-payroll',    emoji: '💰', label: 'Payroll',    color: '#0891B2' },
  { href: '/admin-tiers',      emoji: '🏆', label: 'Tiers',       color: '#D97706' },
  { href: '/admin-promos',     emoji: '🎟', label: 'Promos',     color: '#DB2777' },
  { href: '/admin-festivals',  emoji: '🪔', label: 'Festival themes', color: '#D97706' },
  { href: '/admin-complaints', emoji: '⚠️', label: 'Complaints', color: '#DC2626' },
  { href: '/admin-assistants', emoji: '🔑', label: 'Assistants', color: '#4338CA' },
]

// Everything an assistant is allowed to see in the sidebar. Middleware
// is the real gate (see middleware.ts — it must allow these same routes
// for the 'assistant' role); this list is what renders for them here.
// The 4 shortcuts shown in the phone bottom bar (everything else is under
// "More", which opens the full menu).
const OWNER_QUICK     = ['/admin-overview', '/admin-bookings', '/admin-workers', '/admin-live-map']
const ASSISTANT_QUICK = ['/assistant-dashboard', '/admin-workers', '/admin-complaints', '/admin-slots']

const ASSISTANT_NAV = [
  { href: '/assistant-dashboard', emoji: '📋', label: 'Bookings',   color: '#7C3AED' },
  { href: '/admin-workers',       emoji: '👷', label: 'Workers',    color: '#0891B2' },
  { href: '/admin-complaints',    emoji: '⚠️', label: 'Complaints', color: '#DC2626' },
  { href: '/admin-slots',         emoji: '🗓️', label: 'Slots',      color: '#0891B2' },
  { href: '/admin-live-map',      emoji: '📍', label: 'Live Map',   color: '#0D9488' },
]

// ═══════════════════════════════════════════════════════════════
// Below: lightweight copies of the same helpers/availability logic
// used in bookings_dashboard.tsx. Kept here (rather than imported)
// because this layout mounts globally across every admin page and
// needs its own small, self-contained data fetch for the sidebar
// widgets — not tied to whichever page is currently rendered.
// ═══════════════════════════════════════════════════════════════

const STATUS_META: Record<string, { label: string; bg: string; icon: string }> = {
  pending:      { label: 'Pending',      bg: '#FEF3C7', icon: '⏳' },
  accepted:     { label: 'Assigned',     bg: '#E0E7FF', icon: '👤' },
  otp_verified: { label: 'OTP Verified', bg: '#EDE9FE', icon: '🔓' },
  in_progress:  { label: 'In Progress',  bg: '#CFFAFE', icon: '⚡' },
}

type SidebarWorker = {
  id: string; name: string
  is_available: boolean
  scheduleDates: Record<string, { enabled: boolean; start: string; end: string; breaks: { from: string; to: string }[] }> | null
  hasAnyScheduleDates: boolean
}
type SidebarBooking = {
  id: string; status: string; service_name: string; scheduled_at: string
  worker_id: string | null; worker_name: string; final_amount: number
  pincode: string | null; duration_mins: number
}
type AdminSession = { id: string; email: string; role: 'owner' | 'assistant'; full_name?: string }

function localDateStr(d: Date): string {
  const local = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
}
function timeToMins(t: string) {
  const [h, m] = t.split(':').map(Number); return h * 60 + m
}
// NEW: formats a booking's planned duration (minutes) as '1h 30m' / '45m'
// for the sidebar's Upcoming Schedule duration chip.
function formatSidebarDuration(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

function isWorkerAvailableAt(
  worker: SidebarWorker, scheduledAt: string, durationMins: number,
  existingBookings: { worker_id: string; scheduled_at: string; duration_mins: number }[]
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
    const slotEndMins = slotMins + durationMins
    if (slotMins < timeToMins(dayEntry.start) || slotEndMins > timeToMins(dayEntry.end)) return false
    for (const b of (dayEntry.breaks ?? [])) {
      if (slotMins >= timeToMins(b.from) && slotMins < timeToMins(b.to)) return false
      if (slotEndMins > timeToMins(b.from) && slotMins < timeToMins(b.to)) return false
    }
  } else if (worker.hasAnyScheduleDates) {
    return false
  }
  for (const bk of existingBookings) {
    if (bk.worker_id !== worker.id) continue
    const bkDt  = new Date(bk.scheduled_at)
    const bkEnd = new Date(bkDt.getTime() + bk.duration_mins * 60000)
    if (slotDt < bkEnd && slotEnd > bkDt) return false
  }
  return true
}

// Small donut built from a CSS conic-gradient — no chart library needed.
function StatusDonut({ live, completed, cancelled }: { live: number; completed: number; cancelled: number }) {
  const total = live + completed + cancelled
  if (total === 0) {
    return <p className="text-[11px] text-gray-400 text-center py-2">Nothing to show yet.</p>
  }
  const liveDeg = (live / total) * 360
  const completedDeg = (completed / total) * 360
  const gradient = `conic-gradient(#2F9BF0 0deg ${liveDeg}deg, #22B07D ${liveDeg}deg ${liveDeg + completedDeg}deg, #E0507A ${liveDeg + completedDeg}deg 360deg)`
  const completedPct = Math.round((completed / total) * 100)
  return (
    <div className="flex items-center gap-3">
      <div className="rounded-full flex-shrink-0 flex items-center justify-center" style={{ width: 52, height: 52, background: gradient }}>
        <div className="rounded-full bg-white flex items-center justify-center" style={{ width: 38, height: 38 }}>
          <span className="text-[11px] font-black text-gray-800">{completedPct}%</span>
        </div>
      </div>
      <div className="flex flex-col gap-1 text-[10.5px] text-gray-600">
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#2F9BF0' }}/> Live · {live}</span>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#22B07D' }}/> Done · {completed}</span>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#E0507A' }}/> Cancelled · {cancelled}</span>
      </div>
    </div>
  )
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [open,     setOpen]     = useState(false)
  const [liveJobs, setLiveJobs] = useState(0)
  const [pending,  setPending]  = useState(0)
  const [time,     setTime]     = useState('')
  const supabase = createClient()

  // ── Who's logged in (owner vs assistant) ──
  const [session, setSession] = useState<AdminSession | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const isOwner = session?.role === 'owner'
  const navItems = isOwner ? NAV : ASSISTANT_NAV
  // Sidebar widgets (Status Breakdown, Upcoming Schedule, alert banners)
  // are shown to both roles now — they carry no revenue/₹ figures, so
  // there's nothing in them that needs hiding from an assistant.
  const showWidgets = !!session

  // ── Sidebar widgets state ──
  const [statusCounts, setStatusCounts] = useState({ live: 0, completed: 0, cancelled: 0 })
  const [upcoming, setUpcoming] = useState<SidebarBooking[]>([])
  const [sidebarWorkers, setSidebarWorkers] = useState<SidebarWorker[]>([])
  const [busyBookings, setBusyBookings] = useState<{ worker_id: string; scheduled_at: string; duration_mins: number }[]>([])
  const [zoneEligible, setZoneEligible] = useState<Record<string, Set<string> | null>>({})
  const [assignOpenId, setAssignOpenId] = useState<string | null>(null)
  const [assignPick, setAssignPick] = useState<Record<string,string>>({})
  const [assigning, setAssigning] = useState<string | null>(null)

  // Phone tables → cards: copy each column's heading onto its cells as
  // data-label, so admin-responsive.css can show "STATUS  Pending" etc.
  // Runs on every admin page and again whenever a table changes.
  useEffect(() => {
    const label = () => {
      document.querySelectorAll<HTMLTableElement>('.cz-admin-main table').forEach(t => {
        const heads = Array.from(t.querySelectorAll('thead th')).map(th => (th.textContent ?? '').trim())
        if (!heads.length) return
        t.querySelectorAll('tbody tr').forEach(tr => {
          let col = 0
          Array.from(tr.children).forEach(td => {
            const h = heads[col] ?? ''
            if (h && td.getAttribute('data-label') !== h) td.setAttribute('data-label', h)
            col += Number((td as HTMLTableCellElement).colSpan || 1)
          })
        })
      })
    }
    label()
    let raf = 0
    const mo = new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(label) })
    const root = document.querySelector('.cz-admin-main')
    if (root) mo.observe(root, { childList: true, subtree: true })
    return () => { mo.disconnect(); cancelAnimationFrame(raf) }
  }, [pathname])

  // Close the phone/tablet menu whenever the page changes.
  useEffect(() => { setOpen(false) }, [pathname])

  // Lock page scrolling behind the open menu; Esc closes it.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [open])

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }))
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t)
  }, [])

  // NEW: who's logged in — drives which nav items render and the
  // footer identity block. Fails soft (session stays null) so this
  // layout doesn't break if the fetch itself has a hiccup; the
  // middleware remains the real gate, this is just for display.
  useEffect(() => {
    fetch('/api/admin-auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(data => setSession(data?.session ?? null))
      .finally(() => setSessionLoaded(true))
  }, [])

  useEffect(() => {
    async function fetch() {
      const { data: rows } = await supabase.from('bookings').select('status, addresses(pincode)')
      const sc = await loadStaffScope()
      const data = rows?.filter((b: any) => pinInScope(sc, b.addresses?.pincode))
      if (data) {
        setLiveJobs(data.filter(b => b.status === 'in_progress').length)
        setPending(data.filter(b => b.status === 'pending').length)
      }
    }
    fetch(); const t = setInterval(fetch, 20000); return () => clearInterval(t)
  }, [])

  // NEW: feeds the Status Breakdown donut + Upcoming Schedule + inline
  // quick-assign widgets moved here from the Bookings page's right panel,
  // so they're visible from every admin screen, not just Bookings.
  // Shown to both owner and assistant — none of this data is revenue,
  // so there's nothing here that needs hiding from an assistant.
  const loadSidebarWidgets = useCallback(async () => {
    const todayStr = localDateStr(new Date())
    const liveStatuses = ['pending','accepted','otp_verified','in_progress']

    const [{ data: statusAll }, { data: upcomingAll }, { data: workerAll }, { data: availRows }, { data: schedRows }, { data: activeRows }] =
      await Promise.all([
        supabase.from('bookings').select('status, addresses(pincode)'),
        supabase.from('bookings')
          .select('id,status,final_amount,scheduled_at,worker_id,service_duration_minutes,booking_duration_minutes,extra_time_mins,worker:users!worker_id(full_name),services(name),addresses(pincode)')
          .in('status', liveStatuses)
          .order('scheduled_at', { ascending: true })
          .limit(300),
        supabase.from('users').select('id,full_name').eq('role','worker'),
        supabase.from('workers').select('user_id,is_available'),
        supabase.from('worker_schedule_dates')
          .select('worker_id,date,enabled,start_time,end_time,breaks')
          .gte('date', todayStr),
        supabase.from('bookings').select('worker_id,scheduled_at,service_duration_minutes,booking_duration_minutes,extra_time_mins')
          .in('status', ['pending','accepted','in_progress']),
      ])

    // Assistants: only their areas' bookings and workers.
    const sc = await loadStaffScope()
    const statusRows = statusAll?.filter((b: any) => pinInScope(sc, b.addresses?.pincode))
    const upcomingRows = upcomingAll?.filter((b: any) => pinInScope(sc, b.addresses?.pincode)).slice(0, 6)
    const workerRows = workerAll?.filter((w: any) => workerInScope(sc, w.id))

    if (statusRows) {
      setStatusCounts({
        live: statusRows.filter((b: any) => liveStatuses.includes(b.status)).length,
        completed: statusRows.filter((b: any) => b.status === 'completed').length,
        cancelled: statusRows.filter((b: any) => b.status === 'cancelled').length,
      })
    }

    const availMap: Record<string, boolean> = {}
    ;(availRows ?? []).forEach((w: any) => { availMap[w.user_id] = w.is_available })
    const scheduleDatesMap: Record<string, Record<string, any>> = {}
    ;(schedRows ?? []).forEach((r: any) => {
      if (!scheduleDatesMap[r.worker_id]) scheduleDatesMap[r.worker_id] = {}
      scheduleDatesMap[r.worker_id][r.date] = {
        enabled: r.enabled === true, start: r.start_time ?? '09:00', end: r.end_time ?? '17:00', breaks: r.breaks ?? [],
      }
    })
    if (workerRows) setSidebarWorkers(workerRows.map((w: any) => ({
      id: w.id, name: w.full_name ?? 'Unknown',
      is_available: availMap[w.id] !== undefined ? availMap[w.id] : true,
      scheduleDates: scheduleDatesMap[w.id] ?? null,
      hasAnyScheduleDates: !!scheduleDatesMap[w.id],
    })))

    if (activeRows) setBusyBookings(activeRows.map((b: any) => ({
      worker_id: b.worker_id ?? '',
      scheduled_at: b.scheduled_at,
      duration_mins: (b.service_duration_minutes ?? b.booking_duration_minutes ?? 60) + (b.extra_time_mins ?? 0),
    })))

    if (upcomingRows) {
      const list: SidebarBooking[] = upcomingRows.map((b: any) => ({
        id: b.id, status: b.status,
        service_name: b.services?.name ?? 'Service',
        scheduled_at: b.scheduled_at,
        worker_id: b.worker_id ?? null,
        worker_name: b.worker?.full_name ?? 'Unassigned',
        final_amount: b.final_amount ?? 0,
        pincode: b.addresses?.pincode ?? null,
        duration_mins: (b.service_duration_minutes ?? b.booking_duration_minutes ?? 60) + (b.extra_time_mins ?? 0),
      }))
      setUpcoming(list)

      const uniquePincodes = Array.from(new Set(list.map(b => b.pincode).filter((p): p is string => !!p)))
      if (uniquePincodes.length > 0) {
        const { data: pinRows } = await supabase.from('worker_pincodes').select('pincode,worker_id').in('pincode', uniquePincodes)
        const pincodeWorkerMap: Record<string, Set<string>> = {}
        for (const row of (pinRows ?? []) as any[]) {
          if (!pincodeWorkerMap[row.pincode]) pincodeWorkerMap[row.pincode] = new Set()
          pincodeWorkerMap[row.pincode].add(row.worker_id)
        }
        for (const k of Object.keys(pincodeWorkerMap)) {
          pincodeWorkerMap[k] = new Set(Array.from(pincodeWorkerMap[k]).filter(id => workerInScope(sc, id)))
        }
        const entries = list.map(b => [b.id, b.pincode && pincodeWorkerMap[b.pincode]?.size ? pincodeWorkerMap[b.pincode] : null] as const)
        setZoneEligible(Object.fromEntries(entries))
      } else {
        setZoneEligible({})
      }
    }
  }, [])

  useEffect(() => {
    // Wait for the session check to finish, then load for whichever role
    // is logged in — both owner and assistant use these widgets now.
    if (!sessionLoaded || !session) return
    loadSidebarWidgets()
    const t = setInterval(loadSidebarWidgets, 20000)
    // FIXED: same React Strict Mode + Supabase channel-name-reuse race as
    // bookings_dashboard.tsx — see that file for the full explanation.
    // Unique name per mount avoids it entirely.
    const ch = supabase.channel(`sidebar-bkng-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => loadSidebarWidgets())
      .subscribe()
    return () => { clearInterval(t); supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLoaded, session])

  async function assignFromSidebar(bookingId: string) {
    const workerId = assignPick[bookingId]
    if (!workerId) return
    setAssigning(bookingId)
    const res = await fetch('/api/admin-auth/assign-worker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id: bookingId, worker_id: workerId }),
    })
    const data = await res.json()
    if (!res.ok || !data?.success) {
      alert(data?.error ?? data?.message ?? 'Could not assign this worker.')
      setAssigning(null)
      return
    }
    setAssigning(null)
    setAssignOpenId(null)
    setAssignPick(p => { const n = { ...p }; delete n[bookingId]; return n })
    loadSidebarWidgets()
  }

  async function logout() {
    await fetch('/api/admin-auth/logout', { method: 'POST' })
    router.replace('/login')
  }

  const badge = (href: string) => {
    if (href === '/admin-bookings' && pending  > 0) return pending
    if (href === '/admin-overview' && liveJobs > 0) return liveJobs
    return null
  }

  // In the phone/tablet menu the page links come first and the widgets
  // after them; on the laptop sidebar the order stays as before.
  const Sidebar = ({ onNav }: { onNav?: () => void }) => {
    const wOrder = onNav ? 'order-2' : ''
    const nOrder = onNav ? 'order-1' : ''
    const fOrder = onNav ? 'order-3' : ''
    return (
    <div className="flex flex-col bg-white">
      {/* logo */}
      <div className="px-5 pt-6 pb-5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          {onNav && (
            <button onClick={onNav} aria-label="Close menu"
              className="order-last ml-auto w-9 h-9 rounded-xl flex items-center justify-center bg-gray-100 text-gray-600 text-lg font-bold">
              ✕
            </button>
          )}
          <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-white text-lg"
            style={{ background: 'linear-gradient(135deg,#06B6D4,#2563EB)' }}>C</div>
          <div>
            <p className="font-black text-gray-900 text-base leading-none">Cleenzo</p>
            <p className="text-[10px] text-gray-400 mt-0.5 font-semibold tracking-wider uppercase">Admin Suite</p>
          </div>
        </div>

        {/* time */}
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </span>
          <span className="text-xs font-bold text-blue-600">{time}</span>
        </div>
      </div>

      {/* alerts — shown to both roles */}
      {showWidgets && (liveJobs > 0 || pending > 0) && (
        <div className={`px-3 pt-3 space-y-2 ${wOrder}`}>
          {liveJobs > 0 && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-cyan-50 border border-cyan-100">
              <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse flex-shrink-0"/>
              <p className="text-xs font-bold text-cyan-700">{liveJobs} live job{liveJobs > 1 ? 's' : ''}</p>
            </div>
          )}
          {pending > 0 && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-100">
              <span className="text-xs">⏳</span>
              <p className="text-xs font-bold text-amber-700">{pending} need worker</p>
            </div>
          )}
        </div>
      )}

      {/* ══════════ Status Breakdown widget — shown to both roles ══════════ */}
      {showWidgets && (
        <div className={`mx-3 mt-3 px-3 py-3 rounded-xl bg-gray-50 border border-gray-100 ${wOrder}`}>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Status breakdown</p>
          <StatusDonut live={statusCounts.live} completed={statusCounts.completed} cancelled={statusCounts.cancelled}/>
        </div>
      )}

      {/* ══════════ Upcoming Schedule widget — shown to both roles ══════════ */}
      {showWidgets && upcoming.length > 0 && (
        <div className={`mx-3 mt-3 px-3 py-3 rounded-xl bg-gray-50 border border-gray-100 ${wOrder}`}>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Upcoming schedule</p>
          <div className="flex flex-col gap-2.5">
            {upcoming.map(b => {
              const isUnassigned = !b.worker_id
              const zoneIds = zoneEligible[b.id] ?? null
              const slotAvailable = isUnassigned
                ? sidebarWorkers.filter(w =>
                    isWorkerAvailableAt(w, b.scheduled_at, b.duration_mins, busyBookings) &&
                    (zoneIds == null || zoneIds.has(w.id)))
                : []
              const isOpen = assignOpenId === b.id
              const meta = STATUS_META[b.status] ?? STATUS_META.pending
              return (
                <div key={b.id}>
                  <div
                    onClick={() => isUnassigned ? setAssignOpenId(isOpen ? null : b.id) : undefined}
                    className={`flex items-start gap-2 rounded-lg p-1 -m-1 ${isUnassigned ? 'cursor-pointer hover:bg-white' : ''}`}>
                    <div className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] flex-shrink-0" style={{ background: meta.bg }}>
                      {meta.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold text-gray-800 truncate">{b.service_name}</p>
                      <p className="text-[10px] truncate" style={{ color: isUnassigned ? '#B45309' : '#9CA3AF' }}>
                        {isUnassigned ? '⏳ Unassigned — tap to assign' : b.worker_name.split(' ')[0]}
                      </p>
                      {/* NEW: planned service duration, so it's clear how
                          long this visit is expected to take, not just
                          when it starts. */}
                      <p className="text-[9.5px] font-bold" style={{ color: '#7C3AED' }}>
                        ⏱ {formatSidebarDuration(b.duration_mins)}
                      </p>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      {/* NEW: explicit "Start" label so the time reads as
                          "when this visit begins", distinct from the
                          duration chip on the left. */}
                      <p className="text-[8.5px] font-bold text-gray-400 uppercase tracking-wide">Start</p>
                      <p className="text-[10px] font-black text-blue-600">
                        {new Date(b.scheduled_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      {/* Date qualifier so a 9:30 AM item isn't assumed to be
                          today when it's actually scheduled for tomorrow or
                          later — "Today" is omitted since that's implicit. */}
                      <p className="text-[9px] font-bold text-gray-400">
                        {(() => {
                          const dateLabel = new Date(b.scheduled_at).toLocaleDateString('en-IN',
                            { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
                          const todayLabel = new Date().toLocaleDateString('en-IN',
                            { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
                          const tomorrowLabel = new Date(Date.now() + 86400000).toLocaleDateString('en-IN',
                            { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
                          if (dateLabel === todayLabel) return null
                          if (dateLabel === tomorrowLabel) return 'Tomorrow'
                          return dateLabel
                        })()}
                      </p>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="mt-1.5 ml-1 pl-2 flex items-center gap-1.5 flex-wrap" style={{ borderLeft: '2px dashed #FDE68A' }}>
                      <select value={assignPick[b.id] ?? ''} onChange={e => setAssignPick(p => ({ ...p, [b.id]: e.target.value }))}
                        className="flex-1 min-w-[90px] px-1.5 py-1 rounded-md text-[10px] outline-none bg-white"
                        style={{ border: `1.5px solid ${slotAvailable.length > 0 ? '#FCD34D' : '#FECACA'}` }}>
                        <option value="">{slotAvailable.length === 0 ? 'No workers free' : `${slotAvailable.length} free...`}</option>
                        {slotAvailable.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                      <button onClick={() => assignFromSidebar(b.id)}
                        disabled={!assignPick[b.id] || assigning === b.id || slotAvailable.length === 0}
                        className="px-2 py-1 rounded-md text-[10px] font-black text-white disabled:opacity-40"
                        style={{ background: '#2F9BF0' }}>
                        {assigning === b.id ? '...' : 'Assign'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* nav label */}
      <div className={`px-5 pt-5 pb-2 ${nOrder}`}>
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
          {isOwner ? 'Main Menu' : 'Menu'}
        </p>
      </div>

      {/* nav — filtered to navItems, which is the full NAV for the owner
          and just the assistant dashboard link for an assistant */}
      <nav className={`px-3 space-y-0.5 ${nOrder}`}>
        {navItems.map(item => {
          const isActive = pathname.startsWith(item.href)
          const b = badge(item.href)
          return (
            <Link key={item.href} href={item.href} onClick={onNav}
              className="flex items-center gap-3 px-3 py-2.5 lg:py-2.5 min-h-[44px] rounded-xl text-sm font-semibold transition-all group"
              style={{
                background: isActive ? `${item.color}10` : 'transparent',
                color:      isActive ? item.color : '#6B7280',
              }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base transition-all flex-shrink-0"
                style={{
                  background: isActive ? `${item.color}15` : '#F9FAFB',
                  border:     isActive ? `1px solid ${item.color}25` : '1px solid #F3F4F6',
                }}>
                {item.emoji}
              </div>
              <span className="flex-1 font-semibold">{item.label}</span>
              {b && (
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white flex-shrink-0"
                  style={{ background: item.color }}>
                  {b}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* footer — real identity + role + logout, instead of the old
          hardcoded "Admin / Full Access" placeholder */}
      <div className={`px-3 pb-5 pt-3 border-t border-gray-100 mt-3 ${fOrder}`}>
        <div className="flex items-center gap-3 px-3 py-3 rounded-xl bg-gray-50">
          <div className="w-8 h-8 rounded-full flex items-center justify-center font-black text-sm text-white bg-gradient-to-br from-blue-500 to-purple-500 flex-shrink-0">
            {(session?.full_name || session?.email || 'A').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-gray-900 truncate">{session?.full_name || session?.email || 'Admin'}</p>
            <p className="text-[10px] text-gray-400">{isOwner ? 'Owner · Full Access' : 'Assistant'}</p>
          </div>
          <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0"/>
        </div>
        <button onClick={logout}
          className="mt-2 w-full text-center text-[11px] font-bold text-gray-400 hover:text-red-500 py-1.5 transition-colors">
          Log out
        </button>
      </div>
    </div>
    )
  }

  const active = navItems.find(n => pathname.startsWith(n.href))
  const quickHrefs = isOwner ? OWNER_QUICK : ASSISTANT_QUICK
  const quickItems = quickHrefs
    .map(h => navItems.find(n => n.href === h))
    .filter((n): n is (typeof navItems)[number] => !!n)
  const onQuickPage = quickItems.some(n => pathname.startsWith(n.href))

  return (
    <div className="min-h-screen flex bg-gray-50">

      {/* GLOBAL SOS POPUP — shows on every admin page */}
      <SosWatcher />

      {/* laptop / desktop sidebar (1024px and wider) */}
      <aside className="hidden lg:flex w-60 flex-col fixed h-full z-40 border-r border-gray-100 shadow-sm overflow-y-auto">
        <Sidebar/>
      </aside>

      {/* phone + tablet slide-in menu */}
      <div className={`fixed inset-0 z-50 lg:hidden ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
        <div className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setOpen(false)}/>
        <aside className={`absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-white shadow-2xl overflow-y-auto overscroll-contain transition-transform duration-300 ease-out ${open ? 'translate-x-0' : '-translate-x-full'}`}
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <Sidebar onNav={() => setOpen(false)}/>
        </aside>
      </div>

      {/* main */}
      <main className="flex-1 min-w-0 lg:ml-60 flex flex-col min-h-screen">
        {/* phone + tablet top bar */}
        <div className="lg:hidden flex items-center justify-between gap-3 px-3 sm:px-5 py-2.5 bg-white/95 backdrop-blur border-b border-gray-100 sticky top-0 z-30 shadow-sm"
          style={{ paddingTop: 'max(10px, env(safe-area-inset-top))' }}>
          <button onClick={() => setOpen(true)} aria-label="Open menu"
            className="w-10 h-10 rounded-xl flex items-center justify-center bg-gray-100 flex-shrink-0">
            <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
            </svg>
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center font-black text-sm text-white flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#06B6D4,#2563EB)' }}>C</div>
            <span className="text-gray-900 font-bold text-sm truncate">{active?.label ?? 'Admin'}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {showWidgets && pending > 0 && (
              <Link href={isOwner ? '/admin-bookings' : '/assistant-dashboard'}
                className="hidden sm:flex items-center gap-1 px-2.5 h-9 rounded-xl bg-amber-50 border border-amber-100 text-[11px] font-black text-amber-700">
                ⏳ {pending}
              </Link>
            )}
            <div className="relative">
              <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
                <span>{active?.emoji ?? '📊'}</span>
              </div>
              {showWidgets && liveJobs > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black text-white bg-cyan-500 animate-pulse border-2 border-white">
                  {liveJobs}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="cz-admin-main flex-1 min-w-0 w-full pb-24 md:pb-6 lg:pb-0">{children}</div>
      </main>

      {/* phone bottom bar: 4 shortcuts + More (opens the full menu) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur border-t border-gray-100 shadow-lg"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="grid grid-cols-5 px-1 py-1.5">
          {quickItems.map(item => {
            const isActive = pathname.startsWith(item.href)
            const b = badge(item.href)
            return (
              <Link key={item.href} href={item.href}
                className="relative flex flex-col items-center justify-center gap-0.5 min-h-[52px] mx-0.5 rounded-xl transition-all"
                style={{ background: isActive ? `${item.color}12` : 'transparent' }}>
                <span className="text-xl leading-none">{item.emoji}</span>
                <span className="text-[10px] font-bold truncate max-w-full px-0.5" style={{ color: isActive ? item.color : '#6B7280' }}>
                  {item.label}
                </span>
                {b && (
                  <span className="absolute top-0.5 right-2 min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center text-[9px] font-black text-white"
                    style={{ background: item.color }}>{b}</span>
                )}
              </Link>
            )
          })}
          <button onClick={() => setOpen(true)}
            className="relative flex flex-col items-center justify-center gap-0.5 min-h-[52px] mx-0.5 rounded-xl"
            style={{ background: !onQuickPage ? '#2563EB12' : 'transparent' }}>
            <span className="text-xl leading-none">☰</span>
            <span className="text-[10px] font-bold" style={{ color: !onQuickPage ? '#2563EB' : '#6B7280' }}>More</span>
          </button>
        </div>
      </nav>
    </div>
  )
}