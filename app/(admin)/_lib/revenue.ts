// Single source of truth for "revenue earned" anywhere in the admin app.
//
// Revenue = sum of final_amount for bookings whose status is 'completed',
// attributed to the day/period they were actually COMPLETED
// (work_ended_at) — NOT when they were booked (created_at) or scheduled
// (scheduled_at). Those are three different, equally valid questions
// ("when was this booked" / "when is this happening" / "when did we
// actually get paid for it"), but a single number labeled "Revenue" or
// "Earned" needs to consistently mean the same thing everywhere it's
// shown, or admins comparing two pages will see two different "today"
// totals and assume something's broken (see the ₹674 vs ₹773 mix-up
// this exact function was built to resolve).
//
// Falls back to created_at only for the rare completed booking missing a
// work_ended_at (e.g. completed before that field existed), so it still
// counts toward *some* sensible period instead of silently vanishing
// from every total.
//
// Every page in the admin app that shows a "revenue" / "earned" number
// should call this instead of writing its own status+date filter, so
// pages can never silently drift apart from each other again.
//
// Usage:
//   import { fetchCompletedRevenue } from '../_lib/revenue'
//   const monthRevenue = await fetchCompletedRevenue(supabase, startOfThisMonth)
//   const allTimeRevenue = await fetchCompletedRevenue(supabase, new Date(0))

export interface CompletedRevenueRow {
  final_amount: number | null
  created_at: string
  work_ended_at: string | null
  scheduled_at: string | null
  status: string
  is_manual_booking: boolean | null
}

/**
 * Which date a completed booking's revenue should count toward, in
 * priority order:
 *   1. work_ended_at — when the job was actually finished (best answer)
 *   2. scheduled_at  — when the job was supposed to happen (good proxy
 *      when work_ended_at is missing, e.g. an older record or a data
 *      gap in a particular completion flow)
 *   3. created_at    — when the booking was originally placed (last
 *      resort only; for a RECURRING package visit this can be days or
 *      weeks before the actual visit, so it's the worst of the three —
 *      see the real bug this fixed: a Day-6-of-7 recurring visit
 *      missing work_ended_at was landing its revenue on the day the
 *      whole 7-day package was first booked, not the visit's own day)
 */
function effectiveCompletionDate(r: CompletedRevenueRow): string {
  return r.work_ended_at ?? r.scheduled_at ?? r.created_at
}

/**
 * FIXED: previously each caller ran a single unbounded
 * .select(...).eq('status','completed') query. Supabase/PostgREST caps
 * any query without an explicit range at roughly 1000 rows by default,
 * and without an .order() clause the rows that come back aren't
 * guaranteed to be the most recent ones. In practice this meant: once a
 * business had more than ~1000 completed bookings total, Daily/Weekly
 * views (which need the most RECENT completions) could silently lose
 * data to the cap, while Monthly/Yearly (spanning a full year) looked
 * closer to correct simply because more of what survived the cap fell
 * within a 12-month window. This helper now pages through the full
 * table in batches of 1000 until a batch comes back short, guaranteeing
 * every completed booking is included regardless of table size — this
 * is the single place that fetch happens, so every caller gets the fix
 * automatically.
 */
async function fetchAllCompletedRows(supabase: any): Promise<CompletedRevenueRow[]> {
  const PAGE_SIZE = 1000
  const rows: CompletedRevenueRow[] = []
  let from = 0
  // Ordered explicitly so pagination is deterministic — without this,
  // two consecutive .range() calls aren't guaranteed to partition the
  // table consistently if rows are being inserted/updated concurrently.
  for (;;) {
    const { data, error } = await supabase
      .from('bookings')
      .select('final_amount, created_at, work_ended_at, scheduled_at, status, is_manual_booking')
      .eq('status', 'completed')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      console.error('fetchAllCompletedRows: query failed', error)
      break
    }
    const batch = (data ?? []) as CompletedRevenueRow[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return rows
}

/**
 * The first instant of the current calendar month in IST — used as the
 * "since" boundary for every "this month" revenue/count query across the
 * admin app. Anchored to real IST calendar date rather than whatever
 * timezone the browser/server happens to be running in (same reasoning
 * as the trend chart's day-boundary fix): a server running in UTC
 * computing "start of this month" from its own local clock can land up
 * to 5.5 hours off from the actual start of the month in India.
 */
export function getISTMonthStart(): Date {
  const now = new Date()
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const year = ist.getFullYear()
  const month = ist.getMonth()
  return new Date(Date.UTC(year, month, 1, 0, 0, 0) - 5.5 * 60 * 60 * 1000)
}

/**
 * Sums final_amount for every 'completed' booking whose completion date
 * (work_ended_at, falling back to created_at) is on or after `sinceDate`.
 * Pass `new Date(0)` for an unbounded "all time" total.
 *
 * Note: this fetches every completed booking (no date filter at the
 * query level) rather than filtering work_ended_at in the query itself —
 * that was a real bug previously (see overview_dashboard.tsx history):
 * filtering a nullable timestamp column at the DB level silently drops
 * any row where it's null, which the client-side fallback logic then
 * never gets a chance to run for. This is fine for now; if the
 * `bookings` table grows very large, replace this with a server-side
 * Postgres RPC doing the equivalent SUM/GROUP BY instead of pulling raw
 * rows and summing client-side.
 */
export async function fetchCompletedRevenue(
  supabase: any,
  sinceDate: Date
): Promise<number> {
  const rows = await fetchAllCompletedRows(supabase)
  const sinceMs = sinceDate.getTime()

  return rows
    // Defense-in-depth: re-confirm status client-side too, so this sum
    // can never include a non-completed booking's amount even if the
    // server-side .eq('status','completed') filter above were ever
    // loosened or bypassed by a future edit.
    .filter(r => r.status === 'completed')
    .filter(r => {
      const completedAt = effectiveCompletionDate(r)
      return new Date(completedAt).getTime() >= sinceMs
    })
    .reduce((sum, r) => sum + (r.final_amount ?? 0), 0)
}

/**
 * Same completion-date attribution as fetchCompletedRevenue, but buckets
 * the result into caller-supplied date ranges in one pass — used by the
 * Overview page's Daily/Weekly/Monthly/Yearly trend chart so it doesn't
 * need to refetch the whole completed-bookings table once per bucket.
 */
export async function fetchCompletedRevenueBuckets(
  supabase: any,
  buckets: { start: Date; end: Date }[]
): Promise<number[]> {
  const rows = (await fetchAllCompletedRows(supabase)).filter(r => r.status === 'completed')

  return buckets.map(({ start, end }) => {
    const startMs = start.getTime()
    const endMs = end.getTime()
    return rows
      .filter(r => {
        const completedAt = effectiveCompletionDate(r)
        const t = new Date(completedAt).getTime()
        return t >= startMs && t < endMs
      })
      .reduce((sum, r) => sum + (r.final_amount ?? 0), 0)
  })
}

/**
 * Same as fetchCompletedRevenueBuckets, but also splits out the portion
 * of each bucket's revenue that came from phone/manual bookings
 * (is_manual_booking = true) — used to draw a separate "Phone revenue"
 * line alongside the main revenue line on the Overview trend chart, and
 * to total up a phone-booking count for the period.
 */
export async function fetchCompletedRevenueBucketsSplit(
  supabase: any,
  buckets: { start: Date; end: Date }[]
): Promise<{ revenue: number; phoneRevenue: number; phoneCount: number }[]> {
  const rows = (await fetchAllCompletedRows(supabase)).filter(r => r.status === 'completed')

  return buckets.map(({ start, end }) => {
    const startMs = start.getTime()
    const endMs = end.getTime()
    const bucketRows = rows.filter(r => {
      const completedAt = effectiveCompletionDate(r)
      const t = new Date(completedAt).getTime()
      return t >= startMs && t < endMs
    })
    const phoneRows = bucketRows.filter(r => r.is_manual_booking === true)
    return {
      revenue: bucketRows.reduce((sum, r) => sum + (r.final_amount ?? 0), 0),
      phoneRevenue: phoneRows.reduce((sum, r) => sum + (r.final_amount ?? 0), 0),
      phoneCount: phoneRows.length,
    }
  })
}