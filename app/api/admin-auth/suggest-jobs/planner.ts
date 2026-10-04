// app/api/admin-auth/suggest-jobs/planner.ts
//
// Ranking + full-day planning for one professional's day.
//
// RANKING (single "best next job" suggestions)
//   1. Least idle time — minutes she'd sit waiting before the job starts
//      (after her previous job + travel gap, or after a break / start of
//      shift). A 10:30 job right after a 9–10 job + 30 min gap = 0 idle.
//   2. Then nearest — straight-line distance from her previous job
//      (or her next job if it'd be her first, or home base).
//
// FULL-DAY PLAN ("Assign all")
//   Picks the combination of unassigned jobs that fills the MOST working
//   minutes in her day (checking every combination, not just the next
//   one). If two combinations fill the same minutes, the one with less
//   total travel wins. Her existing jobs are never moved — the plan only
//   fills gaps around them, keeping the same travel gaps as booking.
//
// Pure functions only — no database or network access here.

export type DayJob = {
  id: string; start_mins: number; dur_mins: number; xt: number
  lat: number | null; lng: number | null; pin: string | null; addr: string | null
  service: string; status: string
}
export type DayCandidate = {
  id: string; scheduled_at: string; start_mins: number; dur_mins: number
  lat: number | null; lng: number | null; pin: string | null; addr: string | null
  service: string; customer_name: string | null; area: string | null; pincode: string | null
}
export type DayContext =
  | { ok: false; reason: string }
  | {
      ok: true; shift_start: number; shift_end: number
      breaks: { from: string; to: string }[]
      base: { lat: number; lng: number } | null
      jobs: DayJob[]; candidates: DayCandidate[]
    }

export const TRAVEL_GAP_MINS = 30
export const EXTRA_TIME_GAP_MINS = 10
export const FAR_KM = 5

type Place = { lat: number | null; lng: number | null; pin?: string | null; addr?: string | null; xt?: number }

export function kmBetween(a: Place | null | undefined, b: Place | null | undefined): number | null {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function sameAddress(a: Place, b: Place) {
  return !!a.pin && !!a.addr && a.pin === b.pin && a.addr === b.addr
}

/** Travel gap between an existing/planned job and another job — same rule as booking. */
export function travelGap(a: Place, b: Place): number {
  if (sameAddress(a, b)) return 0
  return (a.xt ?? 0) > 0 || (b.xt ?? 0) > 0 ? EXTRA_TIME_GAP_MINS : TRAVEL_GAP_MINS
}

function toMins(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

export function fmtMins(mins: number) {
  const h24 = Math.floor(mins / 60), m = mins % 60
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${h24 >= 12 ? 'PM' : 'AM'}`
}

type Blocker =
  | { kind: 'job'; start: number; end: number; job: DayJob }
  | { kind: 'break'; start: number; end: number }

function blockersOf(ctx: Extract<DayContext, { ok: true }>): Blocker[] {
  const list: Blocker[] = [
    ...ctx.jobs.map(j => ({ kind: 'job' as const, start: j.start_mins, end: j.start_mins + j.dur_mins, job: j })),
    ...(ctx.breaks ?? []).map(b => ({ kind: 'break' as const, start: toMins(b.from), end: toMins(b.to) })),
  ]
  return list.sort((a, b) => a.start - b.start)
}

// ─────────────────────────────────────────────────────────────────
// Suggestions
// ─────────────────────────────────────────────────────────────────
export type Suggestion = {
  booking_id: string; scheduled_at: string; start_mins: number; dur_mins: number
  service: string; customer_name: string | null; area: string | null; pincode: string | null
  idle_mins: number
  distance_km: number | null
  anchor_type: 'previous' | 'next' | 'base' | 'none'
  anchor_label: string | null
  far: boolean
}

export function rankSuggestions(ctx: Extract<DayContext, { ok: true }>): Suggestion[] {
  const blockers = blockersOf(ctx)
  const jobs = [...ctx.jobs].sort((a, b) => a.start_mins - b.start_mins)

  const out = ctx.candidates.map(c => {
    const cs = c.start_mins, ce = cs + c.dur_mins

    // Whatever comes right before / after this job in her day
    const before = blockers.filter(b => b.start < cs)
    const prev = before.length ? before.reduce((x, y) => (y.end > x.end ? y : x)) : null
    const next = blockers.find(b => b.start >= cs) ?? null

    const gapStart = prev
      ? prev.end + (prev.kind === 'job' ? travelGap(prev.job, c) : 0)
      : ctx.shift_start
    const gapEnd = next
      ? next.start - (next.kind === 'job' ? travelGap(next.job, c) : 0)
      : ctx.shift_end
    const idleBefore = Math.max(0, cs - gapStart)
    const idleAfter = Math.max(0, gapEnd - ce)
    // Idle measured from whatever she's doing before; if this would be
    // the first thing in her day and a job follows, measure to that job.
    const idle = prev ? idleBefore : next ? idleAfter : idleBefore

    // Distance anchor: previous job → next job → home base
    const prevJob = [...jobs].reverse().find(j => j.start_mins < cs) ?? null
    const nextJob = jobs.find(j => j.start_mins > cs) ?? null
    let anchor_type: Suggestion['anchor_type'] = 'none'
    let anchor_label: string | null = null
    let distance_km: number | null = null
    if (prevJob) {
      anchor_type = 'previous'
      distance_km = kmBetween(prevJob, c)
      anchor_label = `after ${prevJob.service} (ends ${fmtMins(prevJob.start_mins + prevJob.dur_mins)})`
    } else if (nextJob) {
      anchor_type = 'next'
      distance_km = kmBetween(c, nextJob)
      anchor_label = `before ${nextJob.service} (${fmtMins(nextJob.start_mins)})`
    } else if (ctx.base) {
      anchor_type = 'base'
      distance_km = kmBetween(ctx.base, c)
      anchor_label = 'from her home base'
    }

    return {
      booking_id: c.id, scheduled_at: c.scheduled_at, start_mins: cs, dur_mins: c.dur_mins,
      service: c.service, customer_name: c.customer_name, area: c.area, pincode: c.pincode,
      idle_mins: idle, distance_km, anchor_type, anchor_label,
      far: distance_km != null && distance_km > FAR_KM,
    }
  })

  return out.sort((a, b) =>
    a.idle_mins - b.idle_mins
    || (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity)
    || a.start_mins - b.start_mins)
}

// ─────────────────────────────────────────────────────────────────
// Full-day plan
// ─────────────────────────────────────────────────────────────────
export type TimelineStop = {
  kind: 'existing' | 'new'
  booking_id: string
  start_mins: number; dur_mins: number
  service: string; customer_name: string | null; area: string | null
  idle_before_mins: number
  km_from_prev: number | null
  far: boolean
}
export type DayPlan = {
  new_booking_ids: string[]
  timeline: TimelineStop[]
  stats: {
    working_mins: number         // her working hours minus breaks
    existing_work_mins: number   // already assigned
    new_work_mins: number        // added by this plan
    total_km: number             // straight-line, whole day
  }
}

export function planDay(
  ctx: Extract<DayContext, { ok: true }>,
  excludeIds: Set<string> = new Set(),
): DayPlan {
  const cands = ctx.candidates
    .filter(c => !excludeIds.has(c.id))
    .sort((a, b) => a.start_mins - b.start_mins || a.dur_mins - b.dur_mins)
  const jobs = [...ctx.jobs].sort((a, b) => a.start_mins - b.start_mins)
  const endOf = (c: DayCandidate) => c.start_mins + c.dur_mins

  // Can candidate b follow candidate a (with the travel gap)?
  const fits = (a: DayCandidate, b: DayCandidate) => endOf(a) + travelGap(a, b) <= b.start_mins

  // Where she travels FROM to reach candidate i, if the previous planned
  // job is `from` (or none): the latest existing job in between wins.
  const stopBefore = (from: DayCandidate | null, i: DayCandidate): Place | null => {
    const between = jobs.filter(j => j.start_mins < i.start_mins && (!from || j.start_mins > from.start_mins))
    if (between.length) return between[between.length - 1]
    if (from) return from
    return ctx.base
  }
  const stepKm = (from: DayCandidate | null, i: DayCandidate) => kmBetween(stopBefore(from, i), i) ?? 0

  // dp[i] = best chain of planned jobs ending with candidate i
  type Best = { work: number; km: number; prev: number }
  const dp: Best[] = cands.map(c => ({ work: c.dur_mins, km: stepKm(null, c), prev: -1 }))
  const better = (a: { work: number; km: number }, b: { work: number; km: number }) =>
    a.work > b.work || (a.work === b.work && a.km < b.km - 1e-9)

  for (let i = 0; i < cands.length; i++) {
    for (let j = 0; j < i; j++) {
      if (!fits(cands[j], cands[i])) continue
      const option = { work: dp[j].work + cands[i].dur_mins, km: dp[j].km + stepKm(cands[j], cands[i]), prev: j }
      if (better(option, dp[i])) dp[i] = option
    }
  }

  let bestEnd = -1
  for (let i = 0; i < dp.length; i++) {
    if (bestEnd === -1 || better(dp[i], dp[bestEnd])) bestEnd = i
  }
  const chosen: DayCandidate[] = []
  for (let k = bestEnd; k !== -1; k = dp[k].prev) chosen.unshift(cands[k])

  // Build the day's timeline (existing + new) in time order
  type Stop = { kind: 'existing' | 'new'; data: DayJob | DayCandidate }
  const stops: Stop[] = [
    ...jobs.map(j => ({ kind: 'existing' as const, data: j as DayJob | DayCandidate })),
    ...chosen.map(c => ({ kind: 'new' as const, data: c as DayJob | DayCandidate })),
  ].sort((a, b) => a.data.start_mins - b.data.start_mins)

  const breaks = (ctx.breaks ?? []).map(b => ({ start: toMins(b.from), end: toMins(b.to) }))
  let totalKm = 0
  const timeline: TimelineStop[] = stops.map((s, idx) => {
    const prev = idx > 0 ? stops[idx - 1].data : null
    const prevPlace: Place | null = prev ?? ctx.base
    const km = kmBetween(prevPlace, s.data)
    if (km != null) totalKm += km
    // Ready time = previous end + travel gap, or end of a break in between, or shift start
    const prevEnd = prev ? prev.start_mins + prev.dur_mins : ctx.shift_start
    let ready = prev ? prevEnd + travelGap(prev as Place, s.data as Place) : ctx.shift_start
    for (const br of breaks) {
      // A break between the previous job and this one: she's ready when it ends
      if (br.start < s.data.start_mins && br.end > prevEnd) ready = Math.max(ready, br.end)
    }
    const isCand = s.kind === 'new'
    const c = s.data as DayCandidate
    return {
      kind: s.kind,
      booking_id: s.data.id,
      start_mins: s.data.start_mins,
      dur_mins: s.data.dur_mins,
      service: s.data.service,
      customer_name: isCand ? c.customer_name : null,
      area: isCand ? c.area : null,
      idle_before_mins: Math.max(0, s.data.start_mins - ready),
      km_from_prev: km,
      far: km != null && km > FAR_KM,
    }
  })

  const breakMins = breaks.reduce((sum, b) =>
    sum + Math.max(0, Math.min(b.end, ctx.shift_end) - Math.max(b.start, ctx.shift_start)), 0)

  return {
    new_booking_ids: chosen.map(c => c.id),
    timeline,
    stats: {
      working_mins: Math.max(0, ctx.shift_end - ctx.shift_start - breakMins),
      existing_work_mins: jobs.reduce((s, j) => s + j.dur_mins, 0),
      new_work_mins: chosen.reduce((s, c) => s + c.dur_mins, 0),
      total_km: Math.round(totalKm * 10) / 10,
    },
  }
}