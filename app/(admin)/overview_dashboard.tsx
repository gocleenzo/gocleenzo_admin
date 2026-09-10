'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, Toast } from './_ui'
// Single source of truth for "revenue earned" — see file for why this
// exists (three pages were previously computing it three different
// ways, based on three different dates).
import { fetchCompletedRevenue, fetchCompletedRevenueBuckets, getISTMonthStart } from './_lib/revenue'

interface AppSettings {
  platform_fee: number
  search_fee: number
  search_fee_enabled: boolean
  updated_at: string
}

interface Stats {
  // Scoped to the selected range (month or all-time) — the two numbers
  // that actually differ between the two dashboard pages.
  rangeBookings: number
  rangeRevenue: number
  // Always LIVE / right-now signals, identical on both pages regardless
  // of range — these describe the current moment, not history, so a
  // "this month" vs "all time" split doesn't meaningfully apply to them.
  todayBookings: number
  pendingBookings: number
  activeWorkers: number
}

// NEW: one day's worth of trend data for the 7-day chart — booking count
// and completed revenue, plus a short day-of-week label for the x-axis.
interface TrendDay {
  label: string
  count: number
  revenue: number
}

// NEW: live status split feeding the donut widget — same three buckets
// used on the Bookings page and in the admin sidebar, so the same "62%
// completed" story reads consistently everywhere in the app.
interface StatusSplit {
  live: number
  completed: number
  cancelled: number
}

/// Shared dashboard body used by BOTH admin-overview (all-time) and
/// admin-overview-monthly (current calendar month) — identical layout,
/// identical queries, differing only in the created_at lower bound
/// applied to the two RANGE-scoped stats (rangeBookings/rangeRevenue).
/// Keeping this as one component means the two pages can never silently
/// drift apart from each other after a future edit to just one of them.
export default function OverviewDashboard({
  range,
}: {
  range: 'month' | 'all'
}) {
  const supabase = createClient()

  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats>({
    rangeBookings: 0,
    rangeRevenue: 0,
    todayBookings: 0,
    pendingBookings: 0,
    activeWorkers: 0,
  })
  const [trend, setTrend] = useState<TrendDay[]>([])
  // NEW: which granularity the trend chart is showing — drives both the
  // bucket boundaries below and the chart's title/axis labels.
  const [trendPeriod, setTrendPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('daily')
  const [statusSplit, setStatusSplit] = useState<StatusSplit>({ live: 0, completed: 0, cancelled: 0 })
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const loadSettings = useCallback(async () => {
    setSettingsError(null)
    const { data, error } = await supabase
      .from('app_settings')
      .select('platform_fee, search_fee, search_fee_enabled, updated_at')
      .eq('id', 'global')
      .maybeSingle()

    if (error) {
      setSettingsError(error.message)
      showToast('Could not load fee settings (see console)', 'error')
      return
    }
    if (data) {
      setSettings(data as AppSettings)
      return
    }
    setSettingsError(
      "No 'global' row found in app_settings. Seed it once via the Supabase SQL editor, then refresh."
    )
    showToast('No settings row found — seed it via SQL editor', 'error')
  }, [supabase])

  const loadStats = useCallback(async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Range lower bound: start of THIS MONTH (IST-anchored, shared with
    // every other page — see getISTMonthStart) for the monthly page, or
    // the epoch (effectively "no filter") for the all-time page.
    const rangeStart = range === 'month'
      ? getISTMonthStart()
      : new Date(0)

    const [rangeCountRes, todayRes, pending, rangeRev, workers, statusRes] = await Promise.all([
      supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', rangeStart.toISOString()),
      supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', today.toISOString()),
      supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'accepted', 'otp_verified', 'in_progress']),
      // FIXED: previously filtered by created_at (booking-placed date),
      // which disagreed with this same page's trend chart (which
      // correctly uses completion date) — a booking placed last month
      // but completed this month either counted here-but-not-there or
      // vice versa. Now both use the exact same shared calculation.
      fetchCompletedRevenue(supabase, rangeStart),
      supabase
        .from('workers')
        .select('location_updated_at'),
      // NEW: feeds the status-breakdown donut. Scoped to the same range
      // as the rest of this page's numbers, so "All Time" shows the
      // all-time split and "This Month" shows this month's split.
      supabase
        .from('bookings')
        .select('status')
        .gte('created_at', rangeStart.toISOString()),
    ])

    // "Active Workers" = location genuinely live right now (2-minute
    // freshness window, same as admin-live-map / admin-coverage / the
    // Workers list) — a live-right-now signal, unaffected by range.
    const LOCATION_STALE_MS = 2 * 60 * 1000
    const liveWorkerCount = ((workers.data ?? []) as { location_updated_at: string | null }[])
      .filter((w) => {
        if (!w.location_updated_at) return false
        return Date.now() - new Date(w.location_updated_at).getTime() <= LOCATION_STALE_MS
      }).length

    const statusRows = (statusRes.data ?? []) as { status: string }[]
    setStatusSplit({
      live: statusRows.filter(b => ['pending','accepted','otp_verified','in_progress'].includes(b.status)).length,
      completed: statusRows.filter(b => b.status === 'completed').length,
      cancelled: statusRows.filter(b => b.status === 'cancelled').length,
    })

    setStats({
      rangeBookings: rangeCountRes.count ?? 0,
      rangeRevenue: rangeRev,
      todayBookings: todayRes.count ?? 0,
      pendingBookings: pending.count ?? 0,
      activeWorkers: liveWorkerCount,
    })
    setLoading(false)
  }, [supabase, range])

  // FIXED: bucket boundaries were previously computed with new Date(),
  // setHours(0,0,0,0), setDate(), etc. — all of which operate in the
  // BROWSER/SERVER's local timezone, not IST. If that environment's clock
  // isn't IST (very common for a deployed Next.js app, and for any admin
  // opening this from outside India), "midnight" could land up to 5.5
  // hours away from actual midnight IST — enough to push a booking made
  // late evening (IST) into "yesterday" or vice versa, silently changing
  // which day's total it counts toward. Every bucket boundary below is
  // now anchored to real IST midnight instants, matching the pattern
  // already used elsewhere in this codebase (see localDateStr in the
  // Bookings page) instead of trusting whatever timezone happens to be
  // running the JS.
  function getISTParts(d: Date): { year: number; month: number; date: number; day: number } {
    const local = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    return { year: local.getFullYear(), month: local.getMonth(), date: local.getDate(), day: local.getDay() }
  }
  function istMidnightUTC(year: number, month: number, date: number): Date {
    // IST is UTC+5:30, so IST midnight occurs 5.5 hours BEFORE UTC
    // midnight of the same calendar date.
    return new Date(Date.UTC(year, month, date, 0, 0, 0) - 5.5 * 60 * 60 * 1000)
  }
  function istLabel(d: Date, opts: Intl.DateTimeFormatOptions): string {
    return d.toLocaleDateString('en-IN', { ...opts, timeZone: 'Asia/Kolkata' })
  }

  // NEW: bucket boundaries for each granularity — daily shows the last
  // 14 days, weekly the last 8 Mon–Sun weeks, monthly the last 12
  // calendar months, yearly the last 5 calendar years. Returned oldest
  // first so the chart reads left-to-right chronologically.
  function getTrendBuckets(period: typeof trendPeriod): { start: Date; end: Date; label: string }[] {
    const nowIST = getISTParts(new Date())
    const todayMidnight = istMidnightUTC(nowIST.year, nowIST.month, nowIST.date)
    const DAY_MS = 24 * 60 * 60 * 1000

    if (period === 'daily') {
      // India has no DST, so every IST calendar day is exactly 24h —
      // safe to step by fixed millisecond offsets from today's real
      // IST-midnight instant rather than re-deriving calendar parts.
      return Array.from({ length: 14 }, (_, i) => {
        const start = new Date(todayMidnight.getTime() - (13 - i) * DAY_MS)
        const end = new Date(start.getTime() + DAY_MS)
        return { start, end, label: istLabel(start, { weekday: 'short' }) }
      })
    }
    if (period === 'weekly') {
      // Week starts Monday (IST). getDay(): 0=Sun..6=Sat → Monday-based offset.
      const mondayOffsetDays = (nowIST.day + 6) % 7
      const thisMonday = new Date(todayMidnight.getTime() - mondayOffsetDays * DAY_MS)
      return Array.from({ length: 8 }, (_, i) => {
        const start = new Date(thisMonday.getTime() - (7 - i) * 7 * DAY_MS)
        const end = new Date(start.getTime() + 7 * DAY_MS)
        return { start, end, label: istLabel(start, { day: 'numeric', month: 'short' }) }
      })
    }
    if (period === 'monthly') {
      return Array.from({ length: 12 }, (_, i) => {
        const monthOffset = 11 - i
        // JS Date's month rollover handles negative months correctly
        // (e.g. month -2 correctly resolves to November of the prior
        // year) — used here purely for calendar arithmetic, then fed
        // into the IST-midnight helper for the actual instant.
        const rolled = new Date(nowIST.year, nowIST.month - monthOffset, 1)
        const start = istMidnightUTC(rolled.getFullYear(), rolled.getMonth(), 1)
        const end = istMidnightUTC(rolled.getFullYear(), rolled.getMonth() + 1, 1)
        return { start, end, label: istLabel(start, { month: 'short' }) }
      })
    }
    // yearly
    return Array.from({ length: 5 }, (_, i) => {
      const year = nowIST.year - (4 - i)
      const start = istMidnightUTC(year, 0, 1)
      const end = istMidnightUTC(year + 1, 0, 1)
      return { start, end, label: String(year) }
    })
  }

  // FIXED: previously duplicated its own completion-date attribution
  // logic (including the work_ended_at-missing-field bug fixed earlier)
  // separately from the hero stat's calculation. Now both call the exact
  // same shared function, so this chart and the hero "Revenue" card can
  // never compute two different numbers for the same period again.
  const loadTrend = useCallback(async (period: typeof trendPeriod) => {
    const buckets = getTrendBuckets(period)

    const [countRes, revenues] = await Promise.all([
      supabase
        .from('bookings')
        .select('created_at')
        .gte('created_at', buckets[0].start.toISOString())
        .lt('created_at', buckets[buckets.length - 1].end.toISOString()),
      fetchCompletedRevenueBuckets(supabase, buckets),
    ])

    const countRows = (countRes.data ?? []) as { created_at: string }[]

    const result: TrendDay[] = buckets.map(({ start, end, label }, i) => {
      const startMs = start.getTime()
      const endMs = end.getTime()
      const count = countRows.filter(r => {
        const t = new Date(r.created_at).getTime()
        return t >= startMs && t < endMs
      }).length
      return { label, count, revenue: revenues[i] }
    })
    setTrend(result)
  }, [supabase])

  useEffect(() => {
    loadSettings()
    loadStats()
    loadTrend(trendPeriod)
  }, [loadSettings, loadStats, loadTrend, trendPeriod])

  // NEW: keep both the stat numbers and the charts live — any booking
  // change anywhere in the app (created, status flip, cancelled) nudges
  // this page to refetch, same debounce-free pattern as elsewhere since
  // this page's queries are cheap aggregate counts, not a full table scan.
  useEffect(() => {
    // FIXED: same React Strict Mode + Supabase channel-name-reuse race as
    // bookings_dashboard.tsx — see that file for the full explanation.
    // Unique name per mount avoids it entirely.
    const ch = supabase.channel(`overview-live-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        loadStats()
        loadTrend(trendPeriod)
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trendPeriod])

  async function toggleSearchFee() {
    if (!settings || toggling) return
    setToggling(true)
    const newVal = !settings.search_fee_enabled
    const prev = settings
    setSettings((p) => (p ? { ...p, search_fee_enabled: newVal } : p))

    try {
      const res = await fetch('/api/admin/toggle-search-fee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newVal }),
      })
      const body = await res.json()
      if (!res.ok) {
        setSettings(prev)
        showToast(`Failed: ${body?.error ?? 'unknown error'}`, 'error')
      } else {
        setSettings(body.settings as AppSettings)
        showToast(
          `Search fee ${newVal ? 'enabled' : 'disabled'} — customers ${
            newVal ? 'will' : 'will not'
          } be charged ₹${body.settings.search_fee}`
        )
      }
    } catch {
      setSettings(prev)
      showToast('Failed to reach server — check your connection', 'error')
    }
    setToggling(false)
  }

  const feesTotal =
    (settings?.platform_fee ?? 5) +
    (settings?.search_fee_enabled ? settings?.search_fee ?? 19 : 0)

  const now = new Date()
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening'
  const dateLabel = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

  const rangeLabel = range === 'month'
    ? now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : 'All Time'

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {toast && <Toast msg={toast.msg} type={toast.type} />}

      {/* ── Gradient hero summary band ── */}
      <div className="relative overflow-hidden rounded-3xl mb-5 p-6 md:p-7"
        style={{ background: 'linear-gradient(120deg,#0E7490 0%,#0891B2 45%,#4F46E5 120%)' }}>
        {/* decorative blobs */}
        <div className="absolute -top-16 -right-10 w-56 h-56 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle,#ffffff,transparent 70%)' }} />
        <div className="absolute -bottom-20 left-1/3 w-52 h-52 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle,#ffffff,transparent 70%)' }} />

        <div className="relative">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-white/70 text-xs font-semibold">{dateLabel}</p>
              <h1 className="text-white text-2xl md:text-3xl font-black mt-1 tracking-tight">
                {greeting}, Admin
              </h1>
              <p className="text-white/80 text-sm mt-1">
                {range === 'month'
                  ? `This month's snapshot — ${rangeLabel}.`
                  : "Here's your full all-time business snapshot."}
              </p>
            </div>
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-white/90 bg-white/15 border border-white/20 px-3 py-1.5 rounded-full backdrop-blur-sm shrink-0">
              <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
              Live
            </span>
          </div>

          {/* hero inline stats — Today/Active orders/Location on are
              always CURRENT and identical regardless of range; only
              historical figures are shown separately below. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            {[
              { label: 'Today', value: loading ? '—' : stats.todayBookings, icon: '📅' },
              { label: 'Active orders', value: loading ? '—' : stats.pendingBookings, icon: '⏳', alert: stats.pendingBookings > 0 },
              { label: 'Revenue', value: loading ? '—' : `₹${stats.rangeRevenue.toLocaleString('en-IN')}`, icon: '💰' },
              { label: 'Location on', value: loading ? '—' : stats.activeWorkers, icon: '📍' },
            ].map((s) => (
              <div key={s.label}
                className="rounded-2xl bg-white/12 border border-white/15 backdrop-blur-sm px-4 py-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-white/70 text-[11px] font-bold uppercase tracking-wide">{s.label}</span>
                  <span className="text-base leading-none">{s.icon}</span>
                </div>
                <p className="text-white text-2xl font-black mt-1.5 leading-none">{s.value}</p>
                {s.alert && <p className="text-amber-200 text-[10px] font-bold mt-1">Needs attention</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Range indicator + secondary stat cards (cyan + indigo depth) ── */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">
          Showing: {rangeLabel}
        </p>
        <div className="flex gap-2">
          <a href="/admin-overview-monthly"
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              range === 'month' ? 'bg-cyan-600 text-white' : 'bg-white text-slate-500 border border-slate-200'
            }`}>
            This Month
          </a>
          <a href="/admin-overview"
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              range === 'all' ? 'bg-cyan-600 text-white' : 'bg-white text-slate-500 border border-slate-200'
            }`}>
            All Time
          </a>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-2 gap-4 mb-5">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-24 bg-slate-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 mb-5">
          <FreshStat
            label={range === 'month' ? 'Bookings This Month' : 'Total Bookings'}
            value={stats.rangeBookings}
            icon="📋"
            from="#0891B2" to="#06B6D4"
          />
          <FreshStat
            label={range === 'month' ? 'Revenue This Month' : 'Revenue (all time)'}
            value={`₹${stats.rangeRevenue.toLocaleString('en-IN')}`}
            icon="💰"
            from="#4F46E5" to="#6366F1"
          />
        </div>
      )}

      {/* ══════════ NEW: charts row — revenue trend + status breakdown ══════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <div className="lg:col-span-2">
          <Card
            title={{
              daily: 'Last 14 days',
              weekly: 'Last 8 weeks',
              monthly: 'Last 12 months',
              yearly: 'Last 5 years',
            }[trendPeriod]}
            subtitle="Bookings by date placed · revenue by date completed">
            <div className="px-4 pt-3 flex gap-1.5">
              {([
                { key: 'daily',   label: 'Daily' },
                { key: 'weekly',  label: 'Weekly' },
                { key: 'monthly', label: 'Monthly' },
                { key: 'yearly',  label: 'Yearly' },
              ] as const).map(opt => (
                <button key={opt.key} type="button" onClick={() => setTrendPeriod(opt.key)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all"
                  style={{
                    background: trendPeriod === opt.key ? '#0891B2' : '#F1F5F9',
                    color: trendPeriod === opt.key ? '#fff' : '#64748B',
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
            <TrendChart data={trend} />
          </Card>
        </div>
        <Card title="Status breakdown" subtitle={`${range === 'month' ? 'This month' : 'All time'}`}>
          <div className="p-4">
            <StatusDonut split={statusSplit} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Fee settings — spans 2 */}
        <div className="lg:col-span-2">
          <Card
            title="Fee Settings"
            subtitle="Controls what customers are charged at checkout"
          >
            {settingsError && (
              <div className="px-4 py-3 bg-red-50 border-b border-red-100">
                <p className="text-xs text-red-600 font-semibold">⚠ {settingsError}</p>
              </div>
            )}

            <div className="divide-y divide-slate-50">
              {/* Platform fee */}
              <div className="px-4 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-cyan-50 border border-cyan-100 flex items-center justify-center">
                    🏷️
                  </div>
                  <div>
                    <p className="font-bold text-slate-800 text-sm">Platform Fee</p>
                    <p className="text-[11px] text-slate-400">Fixed charge on every booking</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-black text-slate-900">
                    ₹{settings?.platform_fee ?? 5}
                  </span>
                  <span className="text-[11px] bg-slate-100 text-slate-500 font-bold px-2.5 py-1 rounded-full">
                    Always ON
                  </span>
                </div>
              </div>

              {/* Search fee */}
              <div
                className={`px-4 py-3.5 flex items-center justify-between transition-colors ${
                  settings?.search_fee_enabled ? 'bg-cyan-50/40' : 'bg-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center border ${
                      settings?.search_fee_enabled
                        ? 'bg-cyan-50 border-cyan-100'
                        : 'bg-slate-50 border-slate-100'
                    }`}
                  >
                    🔍
                  </div>
                  <div>
                    <p className="font-bold text-slate-800 text-sm">Search Fee</p>
                    <p className="text-[11px] text-slate-400">Added when worker matching is active</p>
                    {settings?.updated_at && (
                      <p className="text-[11px] text-slate-300 mt-0.5">
                        Last changed{' '}
                        {new Date(settings.updated_at).toLocaleString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: true,
                        })}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-lg font-black ${
                      settings?.search_fee_enabled ? 'text-cyan-700' : 'text-slate-300'
                    }`}
                  >
                    ₹{settings?.search_fee ?? 19}
                  </span>
                  <button
                    type="button"
                    onClick={toggleSearchFee}
                    disabled={toggling || !settings}
                    aria-pressed={!!settings?.search_fee_enabled}
                    aria-label="Toggle search fee"
                    className={`relative w-12 h-6 rounded-full transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed ${
                      settings?.search_fee_enabled ? 'bg-cyan-500' : 'bg-slate-200'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                        settings?.search_fee_enabled ? 'translate-x-6' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Checkout preview */}
        <Card title="Checkout Preview" subtitle="What the customer sees">
          <div className="p-4">
            <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 space-y-2">
              <Row label="Service total" value="₹X" />
              <Row label="Platform fee" value={`₹${settings?.platform_fee ?? 5}`} />
              {settings?.search_fee_enabled && (
                <Row label="Search fee" value={`₹${settings?.search_fee ?? 19}`} />
              )}
              <div className="border-t border-slate-200 pt-2 flex justify-between">
                <span className="font-black text-slate-900 text-sm">Fees total</span>
                <span className="font-black text-cyan-700 text-sm">₹{feesTotal}</span>
              </div>
            </div>
            <p
              className={`text-[11px] mt-3 font-semibold ${
                settings?.search_fee_enabled ? 'text-cyan-600' : 'text-slate-400'
              }`}
            >
              {settings?.search_fee_enabled
                ? `✓ Search fee ON — customers pay ₹${feesTotal} in fees`
                : `✗ Search fee OFF — customers pay ₹${settings?.platform_fee ?? 5} in fees`}
            </p>
          </div>
        </Card>
      </div>

      {/* Quick links — correct admin routes */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
        {[
          { label: 'All Bookings', href: '/admin-bookings', icon: '📋', accent: '#2563EB' },
          { label: 'Workers', href: '/admin-workers', icon: '👷', accent: '#0891B2' },
          { label: 'Live Map', href: '/admin-live-map', icon: '📍', accent: '#0D9488' },
          { label: 'Coverage', href: '/admin-coverage', icon: '🛰️', accent: '#0891B2' },
        ].map(({ label, href, icon, accent }) => (
          <a
            key={href}
            href={href}
            className="group rounded-2xl border border-slate-200 bg-white p-4 flex items-center gap-3 hover:border-cyan-300 hover:shadow-md hover:-translate-y-0.5 transition-all"
          >
            <span
              className="w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-transform group-hover:scale-110"
              style={{ background: `${accent}14` }}
            >
              {icon}
            </span>
            <span className="text-sm font-bold text-slate-700">{label}</span>
            <span className="ml-auto text-slate-300 group-hover:text-cyan-500 transition-colors">→</span>
          </a>
        ))}
      </div>
    </div>
  )
}

// Fresh gradient stat card (local — does not touch shared _ui)
function FreshStat({ label, value, icon, from, to }: {
  label: string; value: string | number; icon: string; from: string; to: string
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl p-5 text-white shadow-sm"
      style={{ background: `linear-gradient(135deg,${from},${to})` }}>
      <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full opacity-15"
        style={{ background: 'radial-gradient(circle,#ffffff,transparent 70%)' }} />
      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="text-white/80 text-[11px] font-bold uppercase tracking-wide">{label}</span>
          <span className="text-lg leading-none">{icon}</span>
        </div>
        <p className="text-3xl font-black mt-2 leading-none">{value}</p>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-700 font-medium">{value}</span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// TrendChart — pure inline SVG bar+line chart, zero chart-library
// dependency. Plots booking count as bars and revenue as a line on
// the same 7-day axis, with the latest day's revenue value always
// visible above its point (not hidden behind a hover state, since
// admins scanning quickly shouldn't have to hover for the headline
// number).
// ═══════════════════════════════════════════════════════════════
// NEW: compact currency formatting so 14+ value labels don't overlap or
// overflow — e.g. ₹12,400 becomes ₹12.4k, ₹1,050,000 becomes ₹10.5L
// (Indian lakh, since amounts here are in ₹).
function formatCompactINR(n: number): string {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}k`
  return `₹${Math.round(n)}`
}

function TrendChart({ data }: { data: TrendDay[] }) {
  if (data.length === 0) {
    return <div className="p-8 text-center text-sm text-slate-400">Loading trend…</div>
  }
  const width = 560
  const height = 200
  const padX = 28
  // Extra top padding so every point's value label has room above the
  // line, not just the last one.
  const padY = 34
  const chartW = width - padX * 2
  const chartH = height - padY - 20
  const maxCount = Math.max(1, ...data.map(d => d.count))
  const maxRevenue = Math.max(1, ...data.map(d => d.revenue))
  const barW = (chartW / data.length) * (data.length > 10 ? 0.4 : 0.5)

  const points = data.map((d, i) => {
    const x = padX + (chartW / (data.length - 1 || 1)) * i
    const y = padY + chartH - (d.revenue / maxRevenue) * chartH
    return { x, y, d }
  })
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  // Smaller label font once there are many points, so 14+ labels still fit.
  const labelFontSize = data.length > 10 ? 9 : 11

  return (
    <div className="p-4">
      <div className="flex items-center gap-4 mb-2 text-[11px] font-bold">
        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#BAE6FD' }} /> Bookings
        </span>
        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#4F46E5' }} /> Revenue
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        {/* bars = booking count */}
        {data.map((d, i) => {
          const x = padX + (chartW / (data.length - 1 || 1)) * i - barW / 2
          const barH = (d.count / maxCount) * (chartH - 24)
          const y = padY + chartH - barH
          return (
            <rect key={`bar-${i}`} x={x} y={y} width={barW} height={barH} rx={3}
              fill="#BAE6FD" opacity={i === data.length - 1 ? 1 : 0.7} />
          )
        })}
        {/* line = revenue */}
        <path d={linePath} fill="none" stroke="#4F46E5" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={`pt-${i}`} cx={p.x} cy={p.y} r={i === points.length - 1 ? 4 : 2.5}
            fill="#4F46E5" stroke="#fff" strokeWidth={i === points.length - 1 ? 2 : 0} />
        ))}
        {/* NEW: every point's revenue value, always visible — not just
            the last one. Alternates a small vertical offset on dense
            (14-point) charts so adjacent labels don't collide when the
            line zig-zags closely. */}
        {points.map((p, i) => (
          <text key={`val-${i}`} x={p.x} y={Math.max(10, p.y - 8 - (data.length > 10 && i % 2 === 1 ? 9 : 0))}
            textAnchor="middle" fontSize={labelFontSize} fontWeight="700" fill="#4338CA">
            {data.length > 10 ? formatCompactINR(data[i].revenue) : `₹${data[i].revenue.toLocaleString('en-IN')}`}
          </text>
        ))}
        {/* x-axis labels */}
        {data.map((d, i) => {
          const x = padX + (chartW / (data.length - 1 || 1)) * i
          return (
            <text key={`lbl-${i}`} x={x} y={height - 4} textAnchor="middle" fontSize="10" fill="#94A3B8">
              {d.label}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// StatusDonut — pure CSS conic-gradient donut, zero chart-library
// dependency, same visual language as the one used on the Bookings
// page and admin sidebar so the "X% completed" story is consistent
// everywhere in the app.
// ═══════════════════════════════════════════════════════════════
function StatusDonut({ split }: { split: StatusSplit }) {
  const total = split.live + split.completed + split.cancelled
  if (total === 0) {
    return <p className="text-sm text-slate-400 text-center py-6">No bookings in this range yet.</p>
  }
  const liveDeg = (split.live / total) * 360
  const completedDeg = (split.completed / total) * 360
  const gradient = `conic-gradient(#0891B2 0deg ${liveDeg}deg, #10B981 ${liveDeg}deg ${liveDeg + completedDeg}deg, #F43F5E ${liveDeg + completedDeg}deg 360deg)`
  const completedPct = Math.round((split.completed / total) * 100)
  return (
    <div className="flex items-center gap-5">
      <div className="rounded-full flex-shrink-0 flex items-center justify-center" style={{ width: 88, height: 88, background: gradient }}>
        <div className="rounded-full bg-white flex items-center justify-center" style={{ width: 62, height: 62 }}>
          <span className="text-base font-black text-slate-800">{completedPct}%</span>
        </div>
      </div>
      <div className="flex flex-col gap-2 text-[13px]">
        <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#0891B2' }} /> <span className="text-slate-600">Live</span> <span className="font-bold text-slate-800">{split.live}</span></span>
        <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#10B981' }} /> <span className="text-slate-600">Completed</span> <span className="font-bold text-slate-800">{split.completed}</span></span>
        <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#F43F5E' }} /> <span className="text-slate-600">Cancelled</span> <span className="font-bold text-slate-800">{split.cancelled}</span></span>
      </div>
    </div>
  )
}