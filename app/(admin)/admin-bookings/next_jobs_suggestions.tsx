'use client'
// app/(admin)/admin-bookings/next_jobs_suggestions.tsx
//
// "Nearby next jobs" popup. Opens right after a booking is assigned to a
// professional (and from the "🧭 Nearby jobs" button on assigned
// booking cards), listing unassigned bookings on that same day that
// this professional can actually take — closest to their previous job
// first. One click assigns; the list then refreshes for their updated
// day, so a whole route can be built in a few clicks.
//
// Opened from anywhere via openNextJobSuggestions(...) — no props need
// to be threaded through the bookings screen.
import { useCallback, useEffect, useState } from 'react'

type Suggestion = {
  booking_id: string
  scheduled_at: string
  duration_mins: number
  service_label: string
  customer_name: string | null
  customer_id: string | null
  area: string | null
  pincode: string | null
  distance_km: number | null
  anchor_type: 'previous' | 'next' | 'base' | 'none'
  anchor_label: string | null
}

type Target = { workerId: string; workerName: string; date: string }

const EVENT_NAME = 'cleenzo:suggest-next-jobs'

/** Open the popup for this professional, on the day of [scheduledAtIso]. */
export function openNextJobSuggestions(workerId: string, workerName: string, scheduledAtIso: string) {
  if (typeof window === 'undefined' || !workerId) return
  const date = new Date(scheduledAtIso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  window.dispatchEvent(new CustomEvent<Target>(EVENT_NAME, {
    detail: { workerId, workerName: workerName || 'Professional', date },
  }))
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  })
}
function fmtDay(yyyyMmDd: string) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  })
}
function fmtDistance(km: number | null) {
  if (km == null) return null
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`
}
function fmtDuration(mins: number) {
  const h = Math.floor(mins / 60), m = mins % 60
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`
}

const REASONS: Record<string, string> = {
  not_found: 'Booking not found.',
  cannot_assign_status: 'This booking can no longer be assigned.',
  worker_unavailable: 'This professional is currently marked unavailable.',
  worker_not_in_zone: 'This professional does not cover that pincode.',
  worker_on_holiday: 'This professional has a holiday on this date.',
  worker_not_scheduled: 'This professional is not scheduled to work at that time.',
  worker_busy: 'This professional now has an overlapping job.',
}

export default function NextJobsSuggestions({ onAssigned }: { onAssigned: () => void }) {
  const [target, setTarget] = useState<Target | null>(null)
  const [items, setItems] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const [assignedCount, setAssignedCount] = useState(0)

  // Listen for openNextJobSuggestions(...) calls from anywhere on the page
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<Target>).detail
      if (!detail?.workerId) return
      setTarget(detail)
      setAssignedCount(0)
      setItems([])
      setError(null)
    }
    window.addEventListener(EVENT_NAME, handler)
    return () => window.removeEventListener(EVENT_NAME, handler)
  }, [])

  const fetchSuggestions = useCallback(async () => {
    if (!target) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/admin-auth/suggest-jobs?worker_id=${encodeURIComponent(target.workerId)}&date=${target.date}&limit=5`,
        { cache: 'no-store' },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `Error ${res.status}`)
      setItems((json.suggestions ?? []) as Suggestion[])
    } catch (e: any) {
      setError(e?.message ?? 'Could not load suggestions')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [target])

  useEffect(() => { if (target) fetchSuggestions() }, [target, fetchSuggestions])

  async function assign(s: Suggestion) {
    if (!target) return
    setAssigningId(s.booking_id)
    setError(null)
    try {
      const res = await fetch('/api/admin-auth/assign-worker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: s.booking_id, worker_id: target.workerId }),
      })
      const json = await res.json().catch(() => ({}))
      // The assign route wraps the database result in `data` — a refusal
      // (busy, not in zone, …) comes back there, not as an HTTP error.
      const inner = json?.data
      if (!res.ok || json?.success === false || inner?.success === false) {
        const reason = inner?.reason ?? json?.reason
        throw new Error(REASONS[reason] ?? inner?.message ?? json?.error ?? 'Could not assign this booking.')
      }
      // Customer + professional notifications are sent automatically by
      // the database when a booking is assigned — nothing to send here.
      setAssignedCount(c => c + 1)
      onAssigned()
      await fetchSuggestions()
    } catch (e: any) {
      setError(e?.message ?? 'Could not assign this booking.')
    } finally {
      setAssigningId(null)
    }
  }

  if (!target) return null
  const firstName = target.workerName.split(' ')[0]

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/35 backdrop-blur-sm" onClick={() => setTarget(null)} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] w-[calc(100%-32px)] max-w-lg max-h-[88vh] overflow-y-auto bg-white rounded-2xl shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-[17px] font-black text-slate-800">🧭 Nearby jobs for {firstName}</h2>
            <p className="text-[11.5px] text-slate-400 mt-0.5">
              {fmtDay(target.date)} · unassigned jobs that fit their day, closest first
            </p>
          </div>
          <button onClick={() => setTarget(null)}
            className="w-9 h-9 flex-shrink-0 rounded-xl flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all">✕</button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {assignedCount > 0 && (
            <div className="rounded-xl px-3 py-2.5 bg-green-50 border border-green-200">
              <p className="text-[12px] font-bold text-green-700">
                ✓ {assignedCount} more job{assignedCount === 1 ? '' : 's'} added to {firstName}&apos;s day
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-xl px-3 py-2.5 bg-red-50 border border-red-200">
              <p className="text-[12px] font-bold text-red-600">{error}</p>
            </div>
          )}

          {loading && items.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-slate-400">Finding jobs that fit {firstName}&apos;s day…</div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-3xl mb-2">{assignedCount > 0 ? '🎉' : '🗓️'}</p>
              <p className="font-black text-slate-700 text-[14px]">
                {assignedCount > 0 ? `${firstName}'s day is as full as it can get` : 'No unassigned jobs fit this day'}
              </p>
              <p className="text-[12px] text-slate-400 mt-1">
                Either nothing is unassigned that day, or nothing fits around their hours, breaks and other jobs.
              </p>
            </div>
          ) : (
            items.map((s, i) => {
              const dist = fmtDistance(s.distance_km)
              const distText = dist == null
                ? 'Distance unknown — no map pin on this address'
                : s.anchor_type === 'base'
                  ? `${dist} from their home base`
                  : s.anchor_type === 'none'
                    ? dist
                    : `${dist} · ${s.anchor_label}`
              return (
                <div key={s.booking_id}
                  className="rounded-2xl border p-3.5"
                  style={{
                    borderColor: i === 0 ? '#0891B2' : '#E2E8F0',
                    background: i === 0 ? '#F0FDFF' : '#fff',
                  }}>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="min-w-0">
                      <p className="font-black text-[14px] text-slate-800 truncate">
                        {i === 0 && <span className="text-[9.5px] font-black text-white px-1.5 py-0.5 rounded-full mr-1.5 align-middle" style={{ background: '#0891B2' }}>CLOSEST</span>}
                        {s.service_label}
                      </p>
                      <p className="text-[12px] text-slate-500 mt-0.5">
                        🕐 {fmtTime(s.scheduled_at)} · ⏱ {fmtDuration(s.duration_mins)}
                        {s.customer_name ? ` · ${s.customer_name}` : ''}
                      </p>
                      <p className="text-[12px] text-slate-500">
                        📍 {[s.area, s.pincode].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-lg px-2.5 py-1.5 mb-2.5 text-[11.5px] font-bold"
                    style={{ background: '#ECFEFF', color: '#0E7490' }}>
                    🚶 {distText}
                  </div>
                  <button onClick={() => assign(s)} disabled={assigningId !== null}
                    className="w-full h-10 rounded-xl font-black text-[13px] text-white disabled:opacity-40 active:scale-[0.98] transition-all"
                    style={{ background: 'linear-gradient(135deg,#0891B2,#4F46E5)' }}>
                    {assigningId === s.booking_id ? 'Assigning…' : `+ Assign to ${firstName}`}
                  </button>
                </div>
              )
            })
          )}

          <button onClick={() => setTarget(null)}
            className="w-full h-10 rounded-xl font-bold text-[13px] bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all">
            Done
          </button>
        </div>
      </div>
    </>
  )
}