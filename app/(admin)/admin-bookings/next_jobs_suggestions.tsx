'use client'
// app/(admin)/admin-bookings/next_jobs_suggestions.tsx
//
// "🧭 Nearby jobs" popup for ONE professional's day. Two tabs:
//
//   Best next job — ranked by LEAST IDLE TIME first (e.g. her 9–10 job
//                   + 30 min travel gap → a 10:30 job is a perfect fit),
//                   then by NEAREST. Assign one at a time.
//
//   Plan full day — the combination of unassigned jobs that fills the
//                   MOST working hours of her day (then least travel).
//                   Shown as a timeline; remove any job and it
//                   recalculates; "Assign all" assigns the rest.
//
// Opened from anywhere via openNextJobSuggestions(...) — after an
// assignment, or from the 🧭 button on an assigned booking card.
import { useCallback, useEffect, useState } from 'react'

type Suggestion = {
  booking_id: string; scheduled_at: string; start_mins: number; dur_mins: number
  service: string; customer_name: string | null; area: string | null; pincode: string | null
  idle_mins: number; distance_km: number | null
  anchor_type: 'previous' | 'next' | 'base' | 'none'; anchor_label: string | null
  far: boolean
}
type TimelineStop = {
  kind: 'existing' | 'new'; booking_id: string
  start_mins: number; dur_mins: number
  service: string; customer_name: string | null; area: string | null
  idle_before_mins: number; km_from_prev: number | null; far: boolean
}
type DayFailed = { ok: false; reason: string; reason_text: string }
type DayReady = {
      ok: true
      shift: { start_mins: number; end_mins: number; breaks: { from: string; to: string }[] }
      total_fits: number
      suggestions: Suggestion[]
      plan: {
        new_booking_ids: string[]
        timeline: TimelineStop[]
        stats: { working_mins: number; existing_work_mins: number; new_work_mins: number; total_km: number }
      }
    }
type DayResponse = DayFailed | DayReady

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

// ── formatting ────────────────────────────────────────────────
function fmtMins(mins: number) {
  const h24 = Math.floor(mins / 60), m = mins % 60
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${h24 >= 12 ? 'PM' : 'AM'}`
}
function fmtRange(start: number, dur: number) {
  return `${fmtMins(start)} – ${fmtMins(start + dur)}`
}
function fmtHours(mins: number) {
  const h = Math.floor(mins / 60), m = mins % 60
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`
}
function fmtKm(km: number | null) {
  if (km == null) return null
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`
}
function fmtDay(yyyyMmDd: string) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  })
}

const ASSIGN_REASONS: Record<string, string> = {
  not_found: 'booking not found',
  cannot_assign_status: 'no longer assignable',
  worker_unavailable: 'professional marked unavailable',
  worker_not_in_zone: 'professional does not cover that pincode',
  worker_on_holiday: 'professional on holiday',
  worker_not_scheduled: 'outside her working hours',
  worker_busy: 'clashes with another of her jobs',
}

/** Assign one booking via the normal assign route. Returns null on success, or a reason. */
async function assignOne(bookingId: string, workerId: string): Promise<string | null> {
  try {
    const res = await fetch('/api/admin-auth/assign-worker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id: bookingId, worker_id: workerId }),
    })
    const json = await res.json().catch(() => ({}))
    // The assign route wraps the database result in `data` — a refusal
    // (busy, not in zone, …) comes back there, not as an HTTP error.
    const inner = json?.data
    if (!res.ok || json?.success === false || inner?.success === false) {
      const reason = inner?.reason ?? json?.reason
      return ASSIGN_REASONS[reason] ?? inner?.message ?? json?.error ?? 'could not assign'
    }
    return null
  } catch (e: any) {
    return e?.message ?? 'could not assign'
  }
}

// ── small UI bits ─────────────────────────────────────────────
function IdleChip({ mins }: { mins: number }) {
  return mins <= 0 ? (
    <span className="text-[11px] font-black px-2 py-1 rounded-lg" style={{ background: '#DCFCE7', color: '#15803D' }}>
      ✅ Perfect fit — no waiting
    </span>
  ) : (
    <span className="text-[11px] font-black px-2 py-1 rounded-lg"
      style={mins <= 30 ? { background: '#FEF9C3', color: '#A16207' } : { background: '#FFEDD5', color: '#C2410C' }}>
      ⏳ {fmtHours(mins)} idle before it
    </span>
  )
}

function DistanceLine({ km, far, label }: { km: number | null; far: boolean; label: string | null }) {
  const k = fmtKm(km)
  if (k == null) return <p className="text-[11.5px] text-slate-400">📍 Distance unknown — no map pin on this address</p>
  return far ? (
    <p className="text-[11.5px] font-bold" style={{ color: '#DC2626' }}>
      ⚠️ {k}{label ? ` ${label}` : ''} — far; 30 min may not be enough to get there
    </p>
  ) : (
    <p className="text-[11.5px] text-slate-500">📍 {k}{label ? ` ${label}` : ''}</p>
  )
}

export default function NextJobsSuggestions({ onAssigned }: { onAssigned: () => void }) {
  const [target, setTarget] = useState<Target | null>(null)
  const [tab, setTab] = useState<'next' | 'plan'>('next')
  const [day, setDay] = useState<DayResponse | null>(null)
  const [excluded, setExcluded] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [assigningAll, setAssigningAll] = useState(false)
  const [notice, setNotice] = useState<{ ok: string[]; failed: string[] } | null>(null)

  // Listen for openNextJobSuggestions(...) calls from anywhere on the page
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<Target>).detail
      if (!detail?.workerId) return
      setTarget(detail)
      setTab('next')
      setDay(null)
      setExcluded([])
      setError(null)
      setNotice(null)
    }
    window.addEventListener(EVENT_NAME, handler)
    return () => window.removeEventListener(EVENT_NAME, handler)
  }, [])

  const fetchDay = useCallback(async (excl: string[]) => {
    if (!target) return
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ worker_id: target.workerId, date: target.date })
      if (excl.length) qs.set('exclude', excl.join(','))
      const res = await fetch(`/api/admin-auth/suggest-jobs?${qs}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `Error ${res.status}`)
      setDay(json as DayResponse)
    } catch (e: any) {
      setError(e?.message ?? 'Could not load this day')
    } finally {
      setLoading(false)
    }
  }, [target])

  useEffect(() => { if (target) fetchDay(excluded) }, [target, excluded, fetchDay])

  if (!target) return null
  const firstName = target.workerName.split(' ')[0]
  const close = () => setTarget(null)

  async function assignSingle(s: Suggestion) {
    if (!target) return
    setBusyId(s.booking_id)
    setNotice(null)
    const fail = await assignOne(s.booking_id, target.workerId)
    setBusyId(null)
    if (fail) {
      setNotice({ ok: [], failed: [`${s.service} at ${fmtMins(s.start_mins)} — ${fail}`] })
    } else {
      setNotice({ ok: [`${s.service} at ${fmtMins(s.start_mins)}`], failed: [] })
      onAssigned()
    }
    await fetchDay(excluded)
  }

  async function assignAll() {
    const readyDay = day && day.ok === true ? (day as DayReady) : null
    if (!target || !readyDay) return
    const toAssign = readyDay.plan.timeline.filter(t => t.kind === 'new')
    if (toAssign.length === 0) return
    if (!window.confirm(`Assign ${toAssign.length} job${toAssign.length === 1 ? '' : 's'} to ${firstName}?\n\n` +
      toAssign.map(t => `• ${fmtMins(t.start_mins)}  ${t.service}`).join('\n'))) return
    setAssigningAll(true)
    setNotice(null)
    const ok: string[] = [], failed: string[] = []
    // One at a time, in time order — each goes through the normal assign
    // checks; anything taken meanwhile is skipped, the rest still go.
    for (const t of toAssign) {
      const fail = await assignOne(t.booking_id, target.workerId)
      const label = `${t.service} at ${fmtMins(t.start_mins)}`
      if (fail) failed.push(`${label} — ${fail}`)
      else ok.push(label)
    }
    setAssigningAll(false)
    setNotice({ ok, failed })
    if (ok.length) onAssigned()
    setExcluded([])
    await fetchDay([])
  }

  // Explicit casts — some TypeScript settings don't narrow `ok: true/false` on their own
  const ready = day && day.ok === true ? (day as DayReady) : null
  const failed = day && day.ok === false ? (day as DayFailed) : null
  const stats = ready?.plan.stats
  const filledNow = stats ? stats.existing_work_mins : 0
  const filledWithPlan = stats ? stats.existing_work_mins + stats.new_work_mins : 0
  const pct = (m: number) => stats && stats.working_mins > 0 ? Math.min(100, Math.round((m / stats.working_mins) * 100)) : 0
  const newStops = ready ? ready.plan.timeline.filter(t => t.kind === 'new') : []

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/35 backdrop-blur-sm" onClick={close} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] w-[calc(100%-32px)] max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-black text-slate-800">🧭 {firstName}&apos;s day · {fmtDay(target.date)}</h2>
              {ready && stats && (
                <p className="text-[11.5px] text-slate-400 mt-0.5">
                  Works {fmtMins(ready.shift.start_mins)} – {fmtMins(ready.shift.end_mins)}
                  {ready.shift.breaks?.length ? ` · break ${ready.shift.breaks.map(b => `${b.from}–${b.to}`).join(', ')}` : ''}
                  {' · '}{fmtHours(filledNow)} of {fmtHours(stats.working_mins)} booked
                </p>
              )}
            </div>
            <button onClick={close}
              className="w-9 h-9 flex-shrink-0 rounded-xl flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all">✕</button>
          </div>
          {ready && (
            <div className="flex gap-1.5 mt-3 p-1 rounded-xl bg-slate-100">
              {([['next', 'Best next job'], ['plan', '⚡ Plan full day']] as const).map(([k, label]) => (
                <button key={k} onClick={() => setTab(k)}
                  className="flex-1 py-2 rounded-lg text-[12.5px] font-black transition-all"
                  style={tab === k ? { background: '#fff', color: '#0E7490', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' } : { color: '#64748B' }}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-4 space-y-3">
          {notice && (notice.ok.length > 0 || notice.failed.length > 0) && (
            <div className="space-y-2">
              {notice.ok.length > 0 && (
                <div className="rounded-xl px-3 py-2.5 bg-green-50 border border-green-200">
                  <p className="text-[12px] font-black text-green-700">✓ Assigned to {firstName}: {notice.ok.length}</p>
                  <p className="text-[11px] text-green-700 mt-0.5">{notice.ok.join(' · ')}</p>
                </div>
              )}
              {notice.failed.length > 0 && (
                <div className="rounded-xl px-3 py-2.5 bg-amber-50 border border-amber-200">
                  <p className="text-[12px] font-black text-amber-700">⚠️ Skipped: {notice.failed.length}</p>
                  {notice.failed.map(f => <p key={f} className="text-[11px] text-amber-700 mt-0.5">{f}</p>)}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-xl px-3 py-2.5 bg-red-50 border border-red-200">
              <p className="text-[12px] font-bold text-red-600">{error}</p>
            </div>
          )}

          {!day && loading && (
            <div className="py-10 text-center text-[13px] text-slate-400">Working out {firstName}&apos;s day…</div>
          )}

          {failed && (
            <div className="py-10 text-center">
              <p className="text-3xl mb-2">🗓️</p>
              <p className="font-black text-slate-700 text-[14px]">{failed.reason_text}</p>
              <p className="text-[12px] text-slate-400 mt-1">No jobs can be suggested for {firstName} on {fmtDay(target.date)}.</p>
            </div>
          )}

          {/* ── Best next job ───────────────────────────────── */}
          {ready && tab === 'next' && (
            ready.suggestions.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-3xl mb-2">🎉</p>
                <p className="font-black text-slate-700 text-[14px]">Nothing else fits {firstName}&apos;s day</p>
                <p className="text-[12px] text-slate-400 mt-1">No unassigned job fits around her hours, breaks and other jobs.</p>
              </div>
            ) : (
              <>
                <p className="text-[11.5px] text-slate-400">
                  Ranked by <b className="text-slate-600">least waiting time</b> (after her previous job + 30 min travel), then <b className="text-slate-600">nearest</b>.
                </p>
                {ready.suggestions.map((s, i) => (
                  <div key={s.booking_id} className="rounded-2xl border p-3.5"
                    style={{ borderColor: i === 0 ? '#0891B2' : '#E2E8F0', background: i === 0 ? '#F0FDFF' : '#fff' }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-black text-[14px] text-slate-800 truncate">
                          {i === 0 && <span className="text-[9.5px] font-black text-white px-1.5 py-0.5 rounded-full mr-1.5 align-middle" style={{ background: '#0891B2' }}>BEST</span>}
                          {s.service}
                        </p>
                        <p className="text-[12px] text-slate-600 font-bold mt-0.5">🕐 {fmtRange(s.start_mins, s.dur_mins)}</p>
                        <p className="text-[12px] text-slate-500">
                          {[s.customer_name, [s.area, s.pincode].filter(Boolean).join(' · ')].filter(Boolean).join(' — ') || '—'}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      <IdleChip mins={s.idle_mins} />
                      <DistanceLine km={s.distance_km} far={s.far} label={s.anchor_label} />
                    </div>
                    <button onClick={() => assignSingle(s)} disabled={busyId !== null || assigningAll}
                      className="mt-2.5 w-full h-10 rounded-xl font-black text-[13px] text-white disabled:opacity-40 active:scale-[0.98] transition-all"
                      style={{ background: 'linear-gradient(135deg,#0891B2,#4F46E5)' }}>
                      {busyId === s.booking_id ? 'Assigning…' : `+ Assign to ${firstName}`}
                    </button>
                  </div>
                ))}
                {ready.total_fits > ready.suggestions.length && (
                  <p className="text-[11.5px] text-slate-400 text-center">
                    +{ready.total_fits - ready.suggestions.length} more fit her day — see <button onClick={() => setTab('plan')} className="font-bold text-cyan-700 hover:underline">Plan full day</button>
                  </p>
                )}
              </>
            )
          )}

          {/* ── Plan full day ───────────────────────────────── */}
          {ready && tab === 'plan' && stats && (
            <>
              <div className="rounded-2xl p-4 border border-cyan-200 bg-cyan-50">
                <p className="text-[12px] font-black text-cyan-800">
                  {newStops.length > 0
                    ? <>This plan fills <span className="text-[15px]">{fmtHours(filledWithPlan)}</span> of {fmtHours(stats.working_mins)}</>
                    : <>{fmtHours(filledNow)} of {fmtHours(stats.working_mins)} booked — nothing more fits</>}
                </p>
                <div className="mt-2 h-2.5 rounded-full bg-white overflow-hidden flex">
                  <div style={{ width: `${pct(filledNow)}%`, background: '#94A3B8' }} />
                  <div style={{ width: `${pct(filledWithPlan) - pct(filledNow)}%`, background: '#0891B2' }} />
                </div>
                <p className="text-[11px] text-cyan-800 mt-1.5">
                  <span className="inline-block w-2 h-2 rounded-sm align-middle mr-1" style={{ background: '#94A3B8' }} />already hers {fmtHours(filledNow)}
                  {newStops.length > 0 && <>
                    {'  '}<span className="inline-block w-2 h-2 rounded-sm align-middle mr-1 ml-2" style={{ background: '#0891B2' }} />+{fmtHours(stats.new_work_mins)} from {newStops.length} new job{newStops.length === 1 ? '' : 's'}
                  </>}
                  {' · '}🚶 {stats.total_km} km total
                </p>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Picks the jobs that fill the <b className="text-slate-600">most working hours</b>. If two plans fill the same hours, the one with <b className="text-slate-600">less travel</b> wins. Her existing jobs are never moved. Tap ✕ to drop a job — the plan recalculates without it.
              </p>

              <div className="space-y-2">
                {ready.plan.timeline.map(t => (
                  <div key={t.booking_id}>
                    {t.idle_before_mins > 0 && (
                      <p className="text-[10.5px] font-bold text-center my-1" style={{ color: t.idle_before_mins > 30 ? '#C2410C' : '#A16207' }}>
                        ⏳ {fmtHours(t.idle_before_mins)} idle
                      </p>
                    )}
                    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 border"
                      style={t.kind === 'new'
                        ? { borderColor: '#67E8F9', background: '#ECFEFF' }
                        : { borderColor: '#E2E8F0', background: '#F8FAFC' }}>
                      <div className="w-[86px] flex-shrink-0">
                        <p className="text-[12px] font-black text-slate-800">{fmtMins(t.start_mins)}</p>
                        <p className="text-[10.5px] text-slate-400">to {fmtMins(t.start_mins + t.dur_mins)}</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-black text-slate-800 truncate">{t.service}</p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {t.kind === 'existing'
                            ? 'Already hers'
                            : [t.customer_name, t.area].filter(Boolean).join(' · ') || 'New job'}
                          {fmtKm(t.km_from_prev) && ` · ${fmtKm(t.km_from_prev)} from last stop`}
                        </p>
                        {t.far && <p className="text-[10.5px] font-bold text-red-600">⚠️ Far — 30 min may not be enough to get there</p>}
                      </div>
                      {t.kind === 'new' ? (
                        <button onClick={() => setExcluded(x => [...x, t.booking_id])} disabled={assigningAll || loading}
                          title="Drop this job from the plan"
                          className="w-7 h-7 flex-shrink-0 rounded-lg flex items-center justify-center text-[12px] font-black bg-white text-slate-400 border border-slate-200 hover:text-red-600 disabled:opacity-40">
                          ✕
                        </button>
                      ) : (
                        <span className="text-[9.5px] font-black px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-500 flex-shrink-0">HERS</span>
                      )}
                    </div>
                  </div>
                ))}
                {ready.plan.timeline.length === 0 && (
                  <p className="text-center text-[12px] text-slate-400 py-6">Nothing booked or available for this day yet.</p>
                )}
              </div>

              {excluded.length > 0 && (
                <p className="text-[11px] text-slate-400 text-center">
                  {excluded.length} job{excluded.length === 1 ? '' : 's'} dropped from the plan ·{' '}
                  <button onClick={() => setExcluded([])} className="font-bold text-cyan-700 hover:underline">Reset</button>
                </p>
              )}

              {newStops.length > 0 && (
                <button onClick={assignAll} disabled={assigningAll || loading}
                  className="w-full h-11 rounded-xl font-black text-[13.5px] text-white disabled:opacity-40 active:scale-[0.98] transition-all"
                  style={{ background: 'linear-gradient(135deg,#0891B2,#4F46E5)' }}>
                  {assigningAll ? 'Assigning…' : `✓ Assign all ${newStops.length} job${newStops.length === 1 ? '' : 's'} to ${firstName}`}
                </button>
              )}
            </>
          )}

          <button onClick={close}
            className="w-full h-10 rounded-xl font-bold text-[13px] bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all">
            Done
          </button>
        </div>
      </div>
    </>
  )
}