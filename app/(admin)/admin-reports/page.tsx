'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type StatusCounts = { pending: number; accepted: number; inProgress: number; completed: number; cancelled: number }
// NEW: App (customer app) vs Phone (manual/phone booking) channel
// split, using the same is_manual_booking flag already relied on
// elsewhere in this codebase (Overview, Bookings dashboard).
type ChannelCounts = { appOrders: number; appRevenue: number; phoneOrders: number; phoneRevenue: number }

type AreaReport    = StatusCounts & ChannelCounts & { area: string; city: string; totalOrders: number; totalRevenue: number; avgOrder: number }
type ServiceReport = StatusCounts & ChannelCounts & { name: string; totalOrders: number; totalRevenue: number; avgOrder: number }
type MonthReport   = StatusCounts & ChannelCounts & { month: string; totalOrders: number; totalRevenue: number; cancelledValue: number }

const emptyStatusCounts = (): StatusCounts => ({ pending: 0, accepted: 0, inProgress: 0, completed: 0, cancelled: 0 })
const emptyChannelCounts = (): ChannelCounts => ({ appOrders: 0, appRevenue: 0, phoneOrders: 0, phoneRevenue: 0 })

const STATUS_META = [
  { key: 'pending'    as const, label: 'Pending',     color: '#D97706' },
  { key: 'accepted'   as const, label: 'Assigned',    color: '#2563EB' },
  { key: 'inProgress' as const, label: 'In Progress', color: '#7C3AED' },
  { key: 'completed'  as const, label: 'Completed',   color: '#059669' },
  { key: 'cancelled'  as const, label: 'Cancelled',   color: '#DC2626' },
]

function formatCompactINR(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(n % 100000 === 0 ? 0 : 1)}L`
  if (n >= 1000) return `₹${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`
  return `₹${n}`
}

export default function AdminReports() {
  const [areas,    setAreas]    = useState<AreaReport[]>([])
  const [services, setServices] = useState<ServiceReport[]>([])
  const [months,   setMonths]   = useState<MonthReport[]>([])
  const [loading,  setLoading]  = useState(true)
  const [tab,      setTab]      = useState<'area'|'service'|'monthly'>('area')
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: bookings } = await supabase
        .from('bookings')
        .select('id,status,final_amount,scheduled_at,is_manual_booking,service_id,services(name),booking_items(service_name),addresses(area,city)')
      if (!bookings) { setLoading(false); return }

      function tally(counts: StatusCounts, status: string) {
        if (status === 'pending')      counts.pending++
        else if (status === 'accepted')     counts.accepted++
        else if (status === 'in_progress')  counts.inProgress++
        else if (status === 'completed')    counts.completed++
        else if (status === 'cancelled')    counts.cancelled++
      }

      // NEW: tallies a booking's App/Phone channel — order counts
      // across every status (a phone booking that got cancelled still
      // counts as a phone-channel order), revenue only for completed
      // ones, matching the same "revenue = completed only" rule used
      // everywhere else on this page.
      function tallyChannel(counts: ChannelCounts, isManual: boolean, status: string, amount: number) {
        if (isManual) {
          counts.phoneOrders++
          if (status === 'completed') counts.phoneRevenue += amount
        } else {
          counts.appOrders++
          if (status === 'completed') counts.appRevenue += amount
        }
      }

      const aMap: Record<string, AreaReport> = {}
      bookings.forEach(b => {
        const area = (b.addresses as any)?.area ?? 'Unknown'; const city = (b.addresses as any)?.city ?? 'Mumbai'
        if (!aMap[area]) aMap[area] = { area, city, totalOrders:0, totalRevenue:0, avgOrder:0, ...emptyStatusCounts(), ...emptyChannelCounts() }
        aMap[area].totalOrders++
        tally(aMap[area], b.status)
        tallyChannel(aMap[area], !!(b as any).is_manual_booking, b.status, (b as any).final_amount ?? 0)
        if (b.status === 'completed') aMap[area].totalRevenue += (b as any).final_amount ?? 0
      })
      setAreas(Object.values(aMap).map(a => ({ ...a, avgOrder: a.completed > 0 ? Math.round(a.totalRevenue / a.completed) : 0 })).sort((a, b) => b.totalRevenue - a.totalRevenue))

      const sMap: Record<string, ServiceReport> = {}
      bookings.forEach(b => {
        // FIXED: previously any booking without a direct service_id
        // link (mostly phone/manual bookings, plus some regular
        // multi-item cart bookings) fell into a catch-all "Unknown"
        // bucket — even though the real service name was sitting right
        // there in booking_items the whole time. Now falls back to
        // that, joining multiple items with "+" for combo bookings
        // (e.g. "Hourly Cleaning + Bathroom Cleaning") rather than
        // guessing which single service the revenue belongs to.
        const items = ((b as any).booking_items ?? []) as { service_name: string }[]
        const name = (b.services as any)?.name
          ?? (items.length > 0 ? items.map(it => it.service_name).join(' + ') : 'Unknown')
        if (!sMap[name]) sMap[name] = { name, totalOrders:0, totalRevenue:0, avgOrder:0, ...emptyStatusCounts(), ...emptyChannelCounts() }
        sMap[name].totalOrders++
        tally(sMap[name], b.status)
        tallyChannel(sMap[name], !!(b as any).is_manual_booking, b.status, (b as any).final_amount ?? 0)
        if (b.status === 'completed') sMap[name].totalRevenue += (b as any).final_amount ?? 0
      })
      setServices(Object.values(sMap).map(s => ({ ...s, avgOrder: s.totalOrders > 0 ? Math.round(s.totalRevenue / s.totalOrders) : 0 })).sort((a, b) => b.totalRevenue - a.totalRevenue))

      const mMap: Record<string, MonthReport> = {}
      bookings.forEach(b => {
        const d = new Date((b as any).scheduled_at)
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
        const lbl = d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
        if (!mMap[key]) mMap[key] = { month: lbl, totalOrders:0, totalRevenue:0, cancelledValue: 0, ...emptyStatusCounts(), ...emptyChannelCounts() }
        mMap[key].totalOrders++
        tally(mMap[key], b.status)
        tallyChannel(mMap[key], !!(b as any).is_manual_booking, b.status, (b as any).final_amount ?? 0)
        if (b.status === 'completed') mMap[key].totalRevenue += (b as any).final_amount ?? 0
        if (b.status === 'cancelled') mMap[key].cancelledValue += (b as any).final_amount ?? 0
      })
      setMonths(Object.entries(mMap).sort(([a],[b]) => b.localeCompare(a)).slice(0,12).map(([,v]) => v).reverse())
      setLoading(false)
    }
    load()
  }, [])

  const TABS = [
    { key: 'area',    icon: '📍', label: 'Area Wise'    },
    { key: 'service', icon: '🧹', label: 'Service Wise' },
    { key: 'monthly', icon: '📅', label: 'Monthly'      },
  ] as const

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin border-slate-200" style={{ borderTopColor: '#059669' }}/>
    </div>
  )

  const totalAreaRev = areas.reduce((s, a) => s + a.totalRevenue, 0)
  const totalSvcRev  = services.reduce((s, s2) => s + s2.totalRevenue, 0)
  const totalOrders  = areas.reduce((s, a) => s + a.totalOrders, 0)

  const overallStatus: StatusCounts = areas.reduce((acc, a) => ({
    pending: acc.pending + a.pending,
    accepted: acc.accepted + a.accepted,
    inProgress: acc.inProgress + a.inProgress,
    completed: acc.completed + a.completed,
    cancelled: acc.cancelled + a.cancelled,
  }), emptyStatusCounts())

  // NEW: overall App vs Phone channel totals, feeding the new
  // "Revenue by Channel" hero section below.
  const overallChannel: ChannelCounts = areas.reduce((acc, a) => ({
    appOrders: acc.appOrders + a.appOrders,
    appRevenue: acc.appRevenue + a.appRevenue,
    phoneOrders: acc.phoneOrders + a.phoneOrders,
    phoneRevenue: acc.phoneRevenue + a.phoneRevenue,
  }), emptyChannelCounts())

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-6 md:px-10 py-10">

        <div className="mb-10">
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Reports &amp; Analytics</h1>
          <p className="text-[15px] text-slate-400 mt-1.5">Area, service and monthly breakdown</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {[
            { label: 'Total Revenue', value: `₹${totalAreaRev.toLocaleString('en-IN')}`, color: '#059669', bg: '#ECFDF5', icon: '💰' },
            { label: 'Total Orders',  value: totalOrders,      color: '#0891B2', bg: '#ECFEFF', icon: '📋' },
            { label: 'Areas Covered', value: areas.length,     color: '#7C3AED', bg: '#F5F3FF', icon: '📍' },
            { label: 'Best Area',     value: areas[0]?.area ?? '—', color: '#D97706', bg: '#FFFBEB', icon: '🏆' },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-2xl p-5 border border-slate-100">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl mb-4" style={{ background: c.bg }}>{c.icon}</div>
              <p className="text-2xl font-black text-slate-900 leading-none mb-1.5 truncate">{c.value}</p>
              <p className="text-[13px] text-slate-400">{c.label}</p>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl p-8 border border-slate-100 mb-10">
          <p className="text-[13px] font-bold uppercase tracking-wide text-slate-400 mb-6">Booking status overview</p>
          <div className="flex flex-col md:flex-row items-center gap-10">
            <StatusDonut counts={overallStatus} />
            <div className="flex-1 w-full space-y-4">
              {STATUS_META.map(s => {
                const value = overallStatus[s.key]
                const total = overallStatus.pending + overallStatus.accepted + overallStatus.inProgress + overallStatus.completed + overallStatus.cancelled
                const pct = total > 0 ? Math.round((value / total) * 100) : 0
                return (
                  <div key={s.key}>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="text-sm font-bold text-slate-600">{s.label}</span>
                      <span className="text-sm">
                        <span className="font-black text-slate-800">{value}</span>
                        <span className="text-slate-400 font-medium ml-1.5">({pct}%)</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: s.color }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* NEW: Revenue by Channel — App booking vs Phone booking,
            same "written + graphical, same numbers driving both" idea
            as the status overview above. Two-color donut instead of a
            full status wheel, since there are only two channels. */}
        <div className="bg-white rounded-2xl p-8 border border-slate-100 mb-10">
          <p className="text-[13px] font-bold uppercase tracking-wide text-slate-400 mb-6">Revenue by channel</p>
          <div className="flex flex-col md:flex-row items-center gap-10">
            <ChannelDonut channel={overallChannel} />
            <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="rounded-xl p-5" style={{ background: '#ECFEFF' }}>
                <p className="text-[12px] font-bold text-cyan-700 mb-1">📱 App Booking</p>
                <p className="text-2xl font-black text-slate-900 leading-none">₹{overallChannel.appRevenue.toLocaleString('en-IN')}</p>
                <p className="text-[12px] text-slate-500 mt-1.5">{overallChannel.appOrders} orders</p>
              </div>
              <div className="rounded-xl p-5" style={{ background: '#FDF2F8' }}>
                <p className="text-[12px] font-bold text-pink-700 mb-1">📞 Phone Booking</p>
                <p className="text-2xl font-black text-slate-900 leading-none">₹{overallChannel.phoneRevenue.toLocaleString('en-IN')}</p>
                <p className="text-[12px] text-slate-500 mt-1.5">{overallChannel.phoneOrders} orders</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 mb-6">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold transition-all"
              style={{
                background: tab === t.key ? '#0F172A' : '#fff',
                color:      tab === t.key ? '#fff'    : '#64748B',
                border:     tab === t.key ? 'none' : '1px solid #E2E8F0',
              }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {tab === 'area' && (
          <div className="space-y-6">
            {areas.length === 0 ? (
              <EmptyState icon="📍" text="No area data yet" />
            ) : (
              <>
                <RevenueBarChart
                  title="Revenue by area"
                  bars={areas.map((a, i) => ({ label: a.area, value: a.totalRevenue, color: ['#0891B2','#7C3AED','#D97706','#059669','#DB2777','#DC2626'][i % 6] }))}
                />

                <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                  {areas.map((a, i) => {
                    const share  = totalAreaRev > 0 ? Math.round((a.totalRevenue / totalAreaRev) * 100) : 0
                    const colors = ['#0891B2','#7C3AED','#D97706','#059669','#DB2777','#DC2626']
                    const c      = colors[i % colors.length]
                    return (
                      <div key={a.area} className={`p-6 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                        <div className="flex items-start justify-between gap-4 mb-4">
                          <div className="flex items-center gap-3.5">
                            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{ background: `${c}12` }}>📍</div>
                            <div>
                              <p className="text-slate-900 font-bold text-[15px]">{a.area}</p>
                              <p className="text-[13px] text-slate-400">{a.city} · #{i + 1} by revenue · {a.totalOrders} orders</p>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="font-black text-xl leading-none" style={{ color: c }}>₹{a.totalRevenue.toLocaleString('en-IN')}</p>
                            <p className="text-[12px] text-slate-400 mt-1">{share}% of revenue · avg ₹{a.avgOrder.toLocaleString('en-IN')}</p>
                          </div>
                        </div>
                        <StatusStrip counts={a} />
                        <ChannelLine channel={a} />
                      </div>
                    )
                  })}
                </div>

                <TotalsFooter label="TOTAL" revenue={totalAreaRev} counts={overallStatus} channel={overallChannel} />
              </>
            )}
          </div>
        )}

        {tab === 'service' && (
          <div className="space-y-6">
            {services.length === 0 ? (
              <EmptyState icon="🧹" text="No service data yet" />
            ) : (
              <>
                <RevenueBarChart
                  title="Revenue by service"
                  bars={services.map((s, i) => ({ label: s.name, value: s.totalRevenue, color: ['#7C3AED','#0891B2','#D97706','#059669','#DB2777','#DC2626'][i % 6] }))}
                />

                <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                  {services.map((s, i) => {
                    const share  = totalSvcRev > 0 ? Math.round((s.totalRevenue / totalSvcRev) * 100) : 0
                    const colors = ['#7C3AED','#0891B2','#D97706','#059669','#DB2777','#DC2626']
                    const c      = colors[i % colors.length]
                    return (
                      <div key={s.name} className={`p-6 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                        <div className="flex items-start justify-between gap-4 mb-4">
                          <div className="flex items-center gap-3.5">
                            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{ background: `${c}12` }}>🧹</div>
                            <div>
                              <p className="text-slate-900 font-bold text-[15px]">{s.name}</p>
                              <p className="text-[13px] text-slate-400">#{i + 1} by revenue · {s.totalOrders} orders</p>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="font-black text-xl leading-none" style={{ color: c }}>₹{s.totalRevenue.toLocaleString('en-IN')}</p>
                            <p className="text-[12px] text-slate-400 mt-1">{share}% of revenue · avg ₹{s.avgOrder.toLocaleString('en-IN')}</p>
                          </div>
                        </div>
                        <StatusStrip counts={s} />
                        <ChannelLine channel={s} />
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'monthly' && (
          <div className="space-y-6">
            {months.length === 0 ? (
              <EmptyState icon="📅" text="No monthly data yet" />
            ) : (
              <>
                <MonthlyTrendChart months={months} />

                <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                  {months.slice().reverse().map((m, i) => {
                    const isTop = i === 0
                    return (
                      <div key={m.month} className={`p-6 ${i > 0 ? 'border-t border-slate-100' : ''}`} style={isTop ? { background: '#F0FDF9' } : undefined}>
                        <div className="flex items-start justify-between gap-4 mb-4">
                          <div className="flex items-center gap-3.5">
                            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{ background: isTop ? '#D1FAE5' : '#F1F5F9' }}>
                              {isTop ? '🏆' : '📅'}
                            </div>
                            <div>
                              <p className="text-slate-900 font-bold text-[15px]">{m.month}</p>
                              <p className="text-[13px] text-slate-400">{m.totalOrders} orders total · {m.completed} completed</p>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="font-black text-xl leading-none text-emerald-700">₹{m.totalRevenue.toLocaleString('en-IN')}</p>
                            <p className="text-[12px] text-slate-400 mt-1">
                              avg ₹{m.completed > 0 ? Math.round(m.totalRevenue / m.completed).toLocaleString('en-IN') : 0}
                              {m.cancelledValue > 0 && <span className="text-red-500 font-semibold"> · ₹{m.cancelledValue.toLocaleString('en-IN')} lost</span>}
                            </p>
                          </div>
                        </div>
                        <StatusStrip counts={m} />
                        <ChannelLine channel={m} />
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="rounded-2xl p-16 text-center bg-white border border-slate-100">
      <p className="text-3xl mb-3">{icon}</p>
      <p className="text-slate-400">{text}</p>
    </div>
  )
}

function StatusStrip({ counts }: { counts: StatusCounts }) {
  const total = counts.pending + counts.accepted + counts.inProgress + counts.completed + counts.cancelled
  if (total === 0) return <p className="text-[12px] text-slate-300">No bookings yet</p>

  return (
    <div>
      <div className="h-2 rounded-full overflow-hidden flex bg-slate-100 mb-3">
        {STATUS_META.map(s => {
          const value = counts[s.key]
          if (value === 0) return null
          return <div key={s.key} style={{ width: `${(value / total) * 100}%`, background: s.color }} />
        })}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {STATUS_META.map(s => (
          <span key={s.key} className="flex items-center gap-1.5 text-[12.5px]">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
            <span className="text-slate-400">{s.label}</span>
            <span className="font-bold text-slate-700">{counts[s.key]}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function TotalsFooter({ label, revenue, counts, channel }: { label: string; revenue: number; counts: StatusCounts; channel: ChannelCounts }) {
  return (
    <div className="rounded-2xl p-6 bg-emerald-50 border border-emerald-100">
      <div className="flex items-center justify-between mb-4">
        <p className="text-slate-900 font-black text-sm tracking-wide">{label}</p>
        <p className="font-black text-2xl text-emerald-700">₹{revenue.toLocaleString('en-IN')}</p>
      </div>
      <StatusStrip counts={counts} />
      <ChannelLine channel={channel} />
    </div>
  )
}

// NEW: a single compact line showing App vs Phone revenue + order
// count for one row — deliberately just text (no extra bar/chart) so
// every area/service/month row doesn't get re-cluttered with another
// visual element; the overall donut above already covers the
// graphical side of this breakdown.
function ChannelLine({ channel }: { channel: ChannelCounts }) {
  if (channel.appOrders === 0 && channel.phoneOrders === 0) return null
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 pt-3 border-t border-slate-100">
      <span className="text-[12px] text-slate-400">
        📱 App: <span className="font-bold text-slate-600">₹{channel.appRevenue.toLocaleString('en-IN')}</span>
        <span className="text-slate-300"> ({channel.appOrders})</span>
      </span>
      <span className="text-[12px] text-slate-400">
        📞 Phone: <span className="font-bold text-slate-600">₹{channel.phoneRevenue.toLocaleString('en-IN')}</span>
        <span className="text-slate-300"> ({channel.phoneOrders})</span>
      </span>
    </div>
  )
}

function RevenueBarChart({ title, bars }: { title: string; bars: { label: string; value: number; color: string }[] }) {
  if (bars.length === 0) return null
  const top = bars.slice(0, 8)
  const max = Math.max(...top.map(b => b.value), 1)
  const rowH = 40
  const height = top.length * rowH + 16
  const width = 700
  const labelW = 130
  const chartW = width - labelW - 70

  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-100">
      <p className="text-[13px] font-bold uppercase tracking-wide text-slate-400 mb-5">{title}</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        {top.map((b, i) => {
          const y = 8 + i * rowH
          const barLen = Math.max((b.value / max) * chartW, b.value > 0 ? 3 : 0)
          return (
            <g key={b.label}>
              <text x={labelW - 10} y={y + rowH / 2 - 4} textAnchor="end" fontSize="12.5" fontWeight="700" fill="#334155">
                {b.label.length > 16 ? b.label.slice(0, 15) + '…' : b.label}
              </text>
              <rect x={labelW} y={y} width={chartW} height={16} rx={6} fill="#F1F5F9" />
              <rect x={labelW} y={y} width={barLen} height={16} rx={6} fill={b.color} />
              <text x={labelW + barLen + 10} y={y + 12.5} fontSize="12.5" fontWeight="800" fill={b.color}>
                {formatCompactINR(b.value)}
              </text>
            </g>
          )
        })}
      </svg>
      {bars.length > 8 && <p className="text-[12px] text-slate-400 mt-2 text-right">+{bars.length - 8} more below</p>}
    </div>
  )
}

function MonthlyTrendChart({ months }: { months: MonthReport[] }) {
  const width = 700
  const height = 240
  const padX = 30
  const padY = 34
  const chartW = width - padX * 2
  const chartH = height - padY - 26
  const maxRev = Math.max(...months.map(m => m.totalRevenue), 1)
  const maxOrders = Math.max(...months.map(m => m.totalOrders), 1)
  const stepX = chartW / (months.length - 1 || 1)
  const barW = (chartW / months.length) * 0.5

  const points = months.map((m, i) => ({
    x: padX + stepX * i,
    y: padY + chartH - (m.totalRevenue / maxRev) * chartH,
  }))
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-100">
      <div className="flex items-center gap-5 mb-4 text-[12.5px] font-bold">
        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#BAE6FD' }} /> Orders
        </span>
        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#059669' }} /> Revenue
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        {months.map((m, i) => {
          const x = padX + stepX * i - barW / 2
          const barH = (m.totalOrders / maxOrders) * (chartH - 24)
          const y = padY + chartH - barH
          return <rect key={`bar-${i}`} x={x} y={y} width={barW} height={barH} rx={4} fill="#BAE6FD" opacity={i === months.length - 1 ? 1 : 0.7} />
        })}
        <path d={linePath} fill="none" stroke="#059669" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={`pt-${i}`} cx={p.x} cy={p.y} r={i === points.length - 1 ? 4 : 2.5} fill="#059669" stroke="#fff" strokeWidth={i === points.length - 1 ? 2 : 0} />
        ))}
        {points.map((p, i) => (
          <text key={`val-${i}`} x={p.x} y={Math.max(12, p.y - 10)} textAnchor="middle" fontSize={months.length > 8 ? 9.5 : 12} fontWeight="700" fill="#047857">
            {formatCompactINR(months[i].totalRevenue)}
          </text>
        ))}
        {months.map((m, i) => (
          <text key={`lbl-${i}`} x={padX + stepX * i} y={height - 8} textAnchor="middle" fontSize="10.5" fill="#94A3B8">
            {m.month}
          </text>
        ))}
      </svg>
    </div>
  )
}

function StatusDonut({ counts }: { counts: StatusCounts }) {
  const total = counts.pending + counts.accepted + counts.inProgress + counts.completed + counts.cancelled

  if (total === 0) {
    return (
      <div className="w-40 h-40 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#F1F5F9' }}>
        <span className="text-xs text-slate-400 font-semibold">No data</span>
      </div>
    )
  }

  let cumulative = 0
  const stops: string[] = []
  for (const seg of STATUS_META) {
    const value = counts[seg.key]
    if (value === 0) continue
    const start = (cumulative / total) * 360
    cumulative += value
    const end = (cumulative / total) * 360
    stops.push(`${seg.color} ${start}deg ${end}deg`)
  }

  const completedPct = Math.round((counts.completed / total) * 100)

  return (
    <div className="relative w-40 h-40 rounded-full flex items-center justify-center flex-shrink-0"
      style={{ background: `conic-gradient(${stops.join(', ')})` }}>
      <div className="absolute w-[102px] h-[102px] rounded-full bg-white flex flex-col items-center justify-center">
        <span className="text-2xl font-black text-slate-900">{completedPct}%</span>
        <span className="text-[10px] text-slate-400 mt-0.5">completed</span>
      </div>
    </div>
  )
}

// NEW — ChannelDonut: same conic-gradient pattern as StatusDonut, but
// a simple two-color App/Phone split instead of 5 statuses.
function ChannelDonut({ channel }: { channel: ChannelCounts }) {
  const total = channel.appRevenue + channel.phoneRevenue

  if (total === 0) {
    return (
      <div className="w-40 h-40 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#F1F5F9' }}>
        <span className="text-xs text-slate-400 font-semibold">No data</span>
      </div>
    )
  }

  const appPct = Math.round((channel.appRevenue / total) * 100)
  const appDeg = (channel.appRevenue / total) * 360

  return (
    <div className="relative w-40 h-40 rounded-full flex items-center justify-center flex-shrink-0"
      style={{ background: `conic-gradient(#06B6D4 0deg ${appDeg}deg, #EC4899 ${appDeg}deg 360deg)` }}>
      <div className="absolute w-[102px] h-[102px] rounded-full bg-white flex flex-col items-center justify-center">
        <span className="text-2xl font-black text-slate-900">{appPct}%</span>
        <span className="text-[10px] text-slate-400 mt-0.5">via app</span>
      </div>
    </div>
  )
}