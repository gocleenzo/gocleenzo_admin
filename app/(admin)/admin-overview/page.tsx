'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, Toast } from '../_ui'

interface AppSettings {
  platform_fee: number
  search_fee: number
  search_fee_enabled: boolean
  updated_at: string
}

interface Stats {
  totalBookings: number
  todayBookings: number
  pendingBookings: number
  totalRevenue: number
  activeWorkers: number
}

export default function AdminOverviewPage() {
  const supabase = createClient()

  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats>({
    totalBookings: 0,
    todayBookings: 0,
    pendingBookings: 0,
    totalRevenue: 0,
    activeWorkers: 0,
  })
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

    const [total, todayRes, pending, revenue, workers] = await Promise.all([
      supabase.from('bookings').select('id', { count: 'exact', head: true }),
      supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', today.toISOString()),
      supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      supabase.from('bookings').select('final_amount').eq('status', 'completed'),
      supabase
        .from('workers')
        .select('id', { count: 'exact', head: true })
        .eq('is_available', true),
    ])

    const totalRev = ((revenue.data ?? []) as { final_amount: number }[]).reduce(
      (s, b) => s + (b.final_amount ?? 0),
      0
    )

    setStats({
      totalBookings: total.count ?? 0,
      todayBookings: todayRes.count ?? 0,
      pendingBookings: pending.count ?? 0,
      totalRevenue: totalRev,
      activeWorkers: workers.count ?? 0,
    })
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    loadSettings()
    loadStats()
  }, [loadSettings, loadStats])

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
              <p className="text-white/80 text-sm mt-1">Here&apos;s your live business snapshot.</p>
            </div>
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-white/90 bg-white/15 border border-white/20 px-3 py-1.5 rounded-full backdrop-blur-sm shrink-0">
              <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
              Live
            </span>
          </div>

          {/* hero inline stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            {[
              { label: 'Today', value: loading ? '—' : stats.todayBookings, icon: '📅' },
              { label: 'Pending', value: loading ? '—' : stats.pendingBookings, icon: '⏳', alert: stats.pendingBookings > 0 },
              { label: 'Revenue', value: loading ? '—' : `₹${stats.totalRevenue.toLocaleString('en-IN')}`, icon: '💰' },
              { label: 'Active workers', value: loading ? '—' : stats.activeWorkers, icon: '👷' },
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

      {/* ── Secondary stat cards (cyan + indigo depth) ── */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-2 gap-4 mb-5">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-24 bg-slate-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 mb-5">
          <FreshStat
            label="Total Bookings"
            value={stats.totalBookings}
            icon="📋"
            from="#0891B2" to="#06B6D4"
          />
          <FreshStat
            label="Revenue (all time)"
            value={`₹${stats.totalRevenue.toLocaleString('en-IN')}`}
            icon="💰"
            from="#4F46E5" to="#6366F1"
          />
        </div>
      )}

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