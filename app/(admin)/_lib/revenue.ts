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
  status: string
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
  const { data } = await supabase
    .from('bookings')
    .select('final_amount, created_at, work_ended_at, status')
    .eq('status', 'completed')

  const rows = (data ?? []) as CompletedRevenueRow[]
  const sinceMs = sinceDate.getTime()

  return rows
    // Defense-in-depth: re-confirm status client-side too, so this sum
    // can never include a non-completed booking's amount even if the
    // server-side .eq('status','completed') filter above were ever
    // loosened or bypassed by a future edit.
    .filter(r => r.status === 'completed')
    .filter(r => {
      const completedAt = r.work_ended_at ?? r.created_at
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
  const { data } = await supabase
    .from('bookings')
    .select('final_amount, created_at, work_ended_at, status')
    .eq('status', 'completed')

  const rows = ((data ?? []) as CompletedRevenueRow[]).filter(r => r.status === 'completed')

  return buckets.map(({ start, end }) => {
    const startMs = start.getTime()
    const endMs = end.getTime()
    return rows
      .filter(r => {
        const completedAt = r.work_ended_at ?? r.created_at
        const t = new Date(completedAt).getTime()
        return t >= startMs && t < endMs
      })
      .reduce((sum, r) => sum + (r.final_amount ?? 0), 0)
  })
}