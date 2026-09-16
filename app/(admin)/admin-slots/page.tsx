'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

// ============================================================================
// Admin Slots page
// ============================================================================
// Two modes, toggled at the top:
//
//  - Single Booking: the ORIGINAL view — shows the same 07:00 AM-07:00 PM
//    grid the customer app's regular booking flow shows, for a chosen
//    pincode/area and date, powered by admin_get_area_slot_grid(). Tapping
//    a free slot opens a popup listing exactly which worker(s) are free.
//
//  - Recurring Package: NEW — shows the same full/partial/none grid the
//    customer app's WEEKLY PACKAGE picker shows, for a chosen pincode and
//    START date (the package runs 7 consecutive days from there), powered
//    by admin_get_area_recurring_slot_grid(). That function does NOT
//    re-implement the worker/booking overlap rule a fourth time — it
//    simply calls admin_get_area_slot_grid() once per day and aggregates
//    the 7 results, so this view can never drift out of sync with the
//    Single Booking view or the customer app; there is exactly one place
//    the actual availability rule lives.
//
// The free-workers-for-a-slot popup only applies to Single Booking mode —
// "who's free" for a recurring package varies day by day across the whole
// week, so that lookup isn't a single answer the same way it is for one
// specific date/time.
// ============================================================================

type AreaOption = {
  pincode: string
  label: string // area name (or parent_area if set) shown alongside the pincode
}

type SlotRow = {
  time_slot: string   // 'HH:MM' 24hr
  available: boolean
  free_count: number
}

// NEW: one row of the recurring (7-day) grid — mirrors the same
// full/partial/none status the customer app's get_recurring_slot_grid
// returns, plus a raw days_covered count for a more precise caption
// than the customer app shows (which only needs the 3-way status).
type RecurringSlotRow = {
  time_slot: string   // 'HH:MM' 24hr
  status: 'full' | 'partial' | 'none'
  days_covered: number
}

type FreeWorker = {
  worker_id: string
  full_name: string
  phone: string
  free_until: string        // ISO timestamp
  free_minutes: number
  free_until_label: string  // e.g. "2:30 PM"
}

type SlotMode = 'single' | 'recurring'

const DURATION_OPTIONS = [
  { label: '30 min', value: 30 },
  { label: '60 min', value: 60 },
  { label: '90 min', value: 90 },
  { label: '120 min', value: 120 },
  { label: '150 min', value: 150 },
  { label: '180 min', value: 180 },
  { label: '240 min', value: 240 },
  { label: '300 min', value: 300 },
  { label: '360 min', value: 360 },
]

function pretty12h(hhmm: string): string {
  const [hStr, m] = hhmm.split(':')
  let h = parseInt(hStr, 10)
  const ampm = h >= 12 ? 'PM' : 'AM'
  if (h > 12) h -= 12
  if (h === 0) h = 12
  return `${h}:${m} ${ampm}`
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Builds the actual timestamptz for a given 'HH:MM' slot on the
// selected date, interpreted in IST — matching every other slot
// computation in this app (admin_get_area_slot_grid, try_claim_slot).
function slotToIso(dateStr: string, hhmm: string): string {
  return `${dateStr}T${hhmm}:00+05:30`
}

function freeDurationLabel(mins: number): string {
  if (mins <= 0) return 'right up to their next job'
  const h = Math.floor(mins / 60), m = mins % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

// Formats a start date + 6 days as e.g. "13 Sep - 19 Sep" so the admin
// can see the exact week a recurring grid describes at a glance.
function weekRangeLabel(startDateStr: string): string {
  const start = new Date(startDateStr + 'T00:00:00')
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  return `${fmt(start)} – ${fmt(end)}`
}

export default function AdminSlotsPage() {
  const supabase = createClient()

  const [areas, setAreas] = useState<AreaOption[]>([])
  const [areasLoading, setAreasLoading] = useState(true)
  const [selectedPincode, setSelectedPincode] = useState('')
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const [duration, setDuration] = useState(60)

  // NEW: which grid is being shown. Switching modes re-triggers
  // loadGrid via the effect below, since it's in that callback's
  // dependency array.
  const [mode, setMode] = useState<SlotMode>('single')

  const [grid, setGrid] = useState<SlotRow[]>([])
  const [recurringGrid, setRecurringGrid] = useState<RecurringSlotRow[]>([])
  const [gridLoading, setGridLoading] = useState(false)
  const [gridError, setGridError] = useState<string | null>(null)

  // ── Free-workers popup state (Single Booking mode only) ─────────
  const [popupSlot, setPopupSlot] = useState<SlotRow | null>(null)
  const [popupWorkers, setPopupWorkers] = useState<FreeWorker[]>([])
  const [popupLoading, setPopupLoading] = useState(false)
  const [popupError, setPopupError] = useState<string | null>(null)

  // ── Load distinct pincode/area options from service_areas ──────
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('service_areas')
        .select('pincode, area, parent_area')
        .eq('is_active', true)
        .order('area')
      if (error) {
        console.error('Load areas error:', error)
        setAreasLoading(false)
        return
      }
      const rows = (data ?? []) as { pincode: string; area: string; parent_area: string | null }[]
      const seen = new Set<string>()
      const opts: AreaOption[] = []
      for (const r of rows) {
        if (!r.pincode || seen.has(r.pincode)) continue
        seen.add(r.pincode)
        opts.push({
          pincode: r.pincode,
          label: `${r.parent_area || r.area} · ${r.pincode}`,
        })
      }
      setAreas(opts)
      if (opts.length > 0) setSelectedPincode(opts[0].pincode)
      setAreasLoading(false)
    })()
  }, [supabase])

  const loadGrid = useCallback(async () => {
    if (!selectedPincode || !selectedDate) return
    setGridLoading(true)
    setGridError(null)

    if (mode === 'single') {
      const { data, error } = await supabase.rpc('admin_get_area_slot_grid', {
        p_pincode: selectedPincode,
        p_date: selectedDate,
        p_duration_mins: duration,
      })
      if (error) {
        console.error('Load slot grid error:', error)
        setGridError(error.message)
        setGrid([])
      } else {
        setGrid((data ?? []) as SlotRow[])
      }
    } else {
      // NEW: recurring (7-day) grid — same pincode/duration inputs,
      // but the date field means "start date" here, and the function
      // itself aggregates 7 days internally.
      const { data, error } = await supabase.rpc('admin_get_area_recurring_slot_grid', {
        p_pincode: selectedPincode,
        p_start_date: selectedDate,
        p_duration_mins: duration,
      })
      if (error) {
        console.error('Load recurring slot grid error:', error)
        setGridError(error.message)
        setRecurringGrid([])
      } else {
        setRecurringGrid((data ?? []) as RecurringSlotRow[])
      }
    }
    setGridLoading(false)
  }, [supabase, selectedPincode, selectedDate, duration, mode])

  useEffect(() => { loadGrid() }, [loadGrid])

  // ── Live updates ──────────────────────────────────────────────
  // Two mechanisms, matching the same "stay current without a manual
  // refresh" behavior the customer app's own slot picker has:
  //   1. Realtime subscription — ANY change to the bookings table
  //      (a new booking placed, one cancelled, a worker assigned, etc.)
  //      immediately re-runs loadGrid(). Scoped to all of `bookings`
  //      rather than filtered to this one pincode/date, since a booking
  //      change anywhere could still affect THIS grid indirectly (e.g.
  //      a worker's holiday/schedule change isn't itself a bookings-row
  //      event, but a booking change is the far more common case this
  //      page cares about) — filtering client-side would need every
  //      possible cause covered, so it's simpler and safe to just
  //      re-check on any bookings change and let loadGrid's own query
  //      do the real filtering.
  //   2. A 30-second periodic refresh as a fallback safety net, in case
  //      a realtime event is ever missed (dropped connection, etc.) —
  //      same interval the customer app's own screens use for their
  //      periodic re-renders.
  useEffect(() => {
    const channel = supabase
      .channel('admin-slots-bookings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' },
        () => { loadGrid() })
      .subscribe()

    const interval = setInterval(() => { loadGrid() }, 30000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [supabase, loadGrid])

  // ── Free-workers popup (Single Booking mode only) ────────────────
  async function openSlot(slot: SlotRow) {
    if (mode !== 'single' || !slot.available) return
    setPopupSlot(slot)
    setPopupWorkers([])
    setPopupError(null)
    setPopupLoading(true)
    try {
      const { data, error } = await supabase.rpc('admin_get_free_workers_for_slot', {
        p_pincode: selectedPincode,
        p_scheduled_at: slotToIso(selectedDate, slot.time_slot),
        p_duration_mins: duration,
      })
      if (error) { setPopupError(error.message); setPopupLoading(false); return }
      setPopupWorkers((data ?? []) as FreeWorker[])
    } catch (e: any) {
      setPopupError(e?.message ?? 'Could not load free workers')
    } finally {
      setPopupLoading(false)
    }
  }

  function closePopup() {
    setPopupSlot(null)
    setPopupWorkers([])
    setPopupError(null)
  }

  const availableCount = grid.filter(s => s.available).length
  const recurringFullCount = recurringGrid.filter(s => s.status === 'full').length
  const recurringPartialCount = recurringGrid.filter(s => s.status === 'partial').length
  const selectedAreaLabel = areas.find(a => a.pincode === selectedPincode)?.label ?? selectedPincode

  const RECURRING_STATUS_STYLE: Record<RecurringSlotRow['status'], { bg: string; border: string; text: string; sub: string; label: string }> = {
    full:    { bg: '#ECFEFF', border: '#06B6D4', text: '#0891B2', sub: '#0891B2', label: 'All 7 days' },
    partial: { bg: '#FFFBEB', border: '#F59E0B', text: '#B45309', sub: '#B45309', label: 'days' },
    none:    { bg: '#F8FAFC', border: '#E2E8F0', text: '#CBD5E1', sub: '#CBD5E1', label: 'Full' },
  }

  return (
    <div className="min-h-screen px-4 md:px-8 py-7 bg-slate-50">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl"
          style={{ background: '#0891B214', border: '1px solid #0891B225' }}>🗓️</div>
        <div>
          <h1 className="text-2xl font-black text-slate-900 leading-tight tracking-tight">Slots</h1>
          <p className="text-xs text-slate-400 font-medium">Area-wise free slot availability</p>
        </div>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] font-bold text-cyan-700 bg-cyan-50 border border-cyan-200 px-3 py-1.5 rounded-full">
          <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
          Live
        </span>
      </div>

      {/* NEW: Single Booking / Recurring Package mode toggle */}
      <div className="flex gap-1 p-1 rounded-2xl bg-white border border-slate-200/80 shadow-sm mb-5 w-fit">
        {([
          { key: 'single' as const, label: '📋 Single Booking' },
          { key: 'recurring' as const, label: '🔁 Recurring Package' },
        ]).map(opt => (
          <button key={opt.key} onClick={() => setMode(opt.key)}
            className="px-4 py-2 rounded-xl text-sm font-black transition-all"
            style={{
              background: mode === opt.key ? 'linear-gradient(135deg,#0891B2,#4F46E5)' : 'transparent',
              color: mode === opt.key ? '#fff' : '#64748B',
            }}>
            {opt.label}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 md:p-5 mb-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5 block">
              Area / Pincode
            </label>
            {areasLoading ? (
              <div className="h-10 rounded-xl bg-slate-100 animate-pulse" />
            ) : (
              <select
                value={selectedPincode}
                onChange={e => setSelectedPincode(e.target.value)}
                className="w-full h-10 px-3 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200">
                {areas.map(a => (
                  <option key={a.pincode} value={a.pincode}>{a.label}</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5 block">
              {mode === 'single' ? 'Date' : 'Start Date'}
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="w-full h-10 px-3 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"
            />
            {mode === 'recurring' && (
              <p className="text-[10px] text-slate-400 mt-1">Package runs {weekRangeLabel(selectedDate)}</p>
            )}
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5 block">
              Service Duration
            </label>
            <select
              value={duration}
              onChange={e => setDuration(Number(e.target.value))}
              className="w-full h-10 px-3 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200">
              {DURATION_OPTIONS.map(d => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={loadGrid}
              disabled={gridLoading}
              className="w-full h-10 rounded-xl font-bold text-sm text-white disabled:opacity-50 active:scale-[0.98] transition-all"
              style={{ background: 'linear-gradient(135deg,#0891B2,#4F46E5)' }}>
              {gridLoading ? 'Loading…' : '↻ Refresh'}
            </button>
          </div>
        </div>
      </div>

      {/* Grid card */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="font-bold text-slate-800 text-sm">
              {selectedAreaLabel}
              {mode === 'recurring' && <span className="text-slate-400 font-semibold"> · {weekRangeLabel(selectedDate)}</span>}
            </p>
            <p className="text-[11px] text-slate-400">
              {gridLoading
                ? 'Checking availability…'
                : mode === 'single'
                  ? `${availableCount} of ${grid.length} slots available · ${duration} min service · tap a free slot to see who's available`
                  : `${recurringFullCount} full-week, ${recurringPartialCount} partial-week slots · ${duration} min service across all 7 days`}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {mode === 'single' ? (
              <>
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#06B6D4' }} />
                  Available
                </span>
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-200" />
                  Full
                </span>
              </>
            ) : (
              <>
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#06B6D4' }} />
                  All 7 days
                </span>
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#F59E0B' }} />
                  Some days
                </span>
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-200" />
                  No days
                </span>
              </>
            )}
          </div>
        </div>

        <div className="p-5">
          {gridError && (
            <div className="mb-4 rounded-xl px-4 py-3 bg-red-50 border border-red-200">
              <p className="text-sm font-bold text-red-600">Could not load slots: {gridError}</p>
            </div>
          )}

          {gridLoading ? (
            <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-2.5">
              {Array.from({ length: 25 }).map((_, i) => (
                <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : mode === 'single' ? (
            grid.length === 0 && !gridError ? (
              <div className="py-16 text-center">
                <p className="text-3xl mb-2">🔍</p>
                <p className="text-slate-500 text-sm">No slot data for this selection</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-2.5">
                {grid.map(slot => (
                  <button
                    key={slot.time_slot}
                    onClick={() => openSlot(slot)}
                    disabled={!slot.available}
                    className="h-16 rounded-xl flex flex-col items-center justify-center border transition-all disabled:cursor-not-allowed hover:enabled:scale-[1.03] hover:enabled:shadow-md"
                    style={{
                      background: slot.available ? '#ECFEFF' : '#F8FAFC',
                      borderColor: slot.available ? '#06B6D4' : '#E2E8F0',
                      cursor: slot.available ? 'pointer' : 'not-allowed',
                    }}>
                    <span className="text-[13px] font-black"
                      style={{ color: slot.available ? '#0891B2' : '#CBD5E1' }}>
                      {pretty12h(slot.time_slot)}
                    </span>
                    {slot.available ? (
                      <span className="text-[10px] font-bold text-cyan-600 mt-0.5">
                        {slot.free_count} free
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-slate-400 mt-0.5">Full</span>
                    )}
                  </button>
                ))}
              </div>
            )
          ) : (
            // NEW: recurring (7-day) grid — informational only, no
            // click-through popup, since "who's free" varies per day
            // across the week rather than being one single answer.
            recurringGrid.length === 0 && !gridError ? (
              <div className="py-16 text-center">
                <p className="text-3xl mb-2">🔍</p>
                <p className="text-slate-500 text-sm">No slot data for this selection</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-2.5">
                {recurringGrid.map(slot => {
                  const st = RECURRING_STATUS_STYLE[slot.status]
                  return (
                    <div
                      key={slot.time_slot}
                      title={`${slot.days_covered} of 7 days available`}
                      className="h-16 rounded-xl flex flex-col items-center justify-center border"
                      style={{ background: st.bg, borderColor: st.border }}>
                      <span className="text-[13px] font-black" style={{ color: st.text }}>
                        {pretty12h(slot.time_slot)}
                      </span>
                      <span className="text-[10px] font-bold mt-0.5" style={{ color: st.sub }}>
                        {slot.status === 'none' ? 'Full' : `${slot.days_covered}/7 days`}
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          )}

          {!gridLoading && mode === 'single' && grid.length > 0 && availableCount === 0 && (
            <div className="mt-4 rounded-xl px-4 py-3 bg-amber-50 border border-amber-200 flex items-center gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <p className="text-sm font-bold text-amber-800">No slots available this day</p>
                <p className="text-[11px] text-amber-600">
                  Every eligible worker in this pincode is fully booked, or none are assigned/scheduled.
                </p>
              </div>
            </div>
          )}

          {!gridLoading && mode === 'recurring' && recurringGrid.length > 0 && recurringFullCount === 0 && (
            <div className="mt-4 rounded-xl px-4 py-3 bg-amber-50 border border-amber-200 flex items-center gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <p className="text-sm font-bold text-amber-800">No time works for a full 7-day package this week</p>
                <p className="text-[11px] text-amber-600">
                  Some slots may still work for {recurringPartialCount > 0 ? 'part of the week (with alternate times on the conflicting days)' : 'nothing'} — customers can pick alternate times per day in the app.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Free-workers popup (Single Booking mode only) */}
      {popupSlot && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={closePopup} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-black text-slate-800">
                  {pretty12h(popupSlot.time_slot)} · {selectedAreaLabel}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Who&apos;s free for a {duration}-min job at this time
                </p>
              </div>
              <button onClick={closePopup}
                className="w-9 h-9 rounded-xl flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all">✕</button>
            </div>

            <div className="px-6 py-5 max-h-[70vh] overflow-y-auto">
              {popupError && (
                <div className="rounded-xl px-4 py-3 bg-red-50 border border-red-200 mb-3">
                  <p className="text-sm font-bold text-red-600">Could not load workers: {popupError}</p>
                </div>
              )}

              {popupLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />
                  ))}
                </div>
              ) : popupWorkers.length === 0 && !popupError ? (
                <div className="py-8 text-center">
                  <p className="text-3xl mb-2">🤔</p>
                  <p className="text-slate-500 text-sm font-semibold">No workers found for this slot</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    The grid said this slot was free — try refreshing if this looks wrong.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {popupWorkers.map(w => (
                    <div key={w.worker_id}
                      className="rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center font-black text-white flex-shrink-0"
                          style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}>
                          {w.full_name?.[0]?.toUpperCase() ?? '?'}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-800 truncate">{w.full_name}</p>
                          <a href={`tel:${w.phone}`} className="text-[11px] text-cyan-600 font-semibold hover:underline">
                            {w.phone}
                          </a>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[11px] text-slate-400">Free until</p>
                        <p className="text-sm font-black text-emerald-600">{w.free_until_label}</p>
                        <p className="text-[10px] text-slate-400">
                          {freeDurationLabel(w.free_minutes)} after this job
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}