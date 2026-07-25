'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type AreaReport    = { area: string; city: string; totalOrders: number; totalRevenue: number; completed: number; cancelled: number; avgOrder: number }
type ServiceReport = { name: string; totalOrders: number; totalRevenue: number; avgOrder: number }
type MonthReport   = { month: string; totalOrders: number; totalRevenue: number }

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
        .select('id,status,final_amount,scheduled_at,services(name),addresses(area,city)')
      if (!bookings) { setLoading(false); return }
      const completed = bookings.filter(b => b.status === 'completed')

      const aMap: Record<string, AreaReport> = {}
      bookings.forEach(b => {
        const area = (b.addresses as any)?.area ?? 'Unknown'; const city = (b.addresses as any)?.city ?? 'Mumbai'
        if (!aMap[area]) aMap[area] = { area, city, totalOrders:0, totalRevenue:0, completed:0, cancelled:0, avgOrder:0 }
        aMap[area].totalOrders++
        if (b.status === 'completed') { aMap[area].completed++; aMap[area].totalRevenue += (b as any).final_amount ?? 0 }
        if (b.status === 'cancelled') aMap[area].cancelled++
      })
      setAreas(Object.values(aMap).map(a => ({ ...a, avgOrder: a.completed > 0 ? Math.round(a.totalRevenue / a.completed) : 0 })).sort((a, b) => b.totalRevenue - a.totalRevenue))

      const sMap: Record<string, ServiceReport> = {}
      bookings.forEach(b => {
        const name = (b.services as any)?.name ?? 'Unknown'
        if (!sMap[name]) sMap[name] = { name, totalOrders:0, totalRevenue:0, avgOrder:0 }
        sMap[name].totalOrders++
        if (b.status === 'completed') sMap[name].totalRevenue += (b as any).final_amount ?? 0
      })
      setServices(Object.values(sMap).map(s => ({ ...s, avgOrder: s.totalOrders > 0 ? Math.round(s.totalRevenue / s.totalOrders) : 0 })).sort((a, b) => b.totalRevenue - a.totalRevenue))

      const mMap: Record<string, MonthReport> = {}
      completed.forEach(b => {
        const d = new Date((b as any).scheduled_at)
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
        const lbl = d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
        if (!mMap[key]) mMap[key] = { month: lbl, totalOrders:0, totalRevenue:0 }
        mMap[key].totalOrders++; mMap[key].totalRevenue += (b as any).final_amount ?? 0
      })
      setMonths(Object.entries(mMap).sort(([a],[b]) => b.localeCompare(a)).slice(0,12).map(([,v]) => v))
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
  const maxMonthRev  = Math.max(...months.map(m => m.totalRevenue), 1)
  const totalOrders  = areas.reduce((s, a) => s + a.totalOrders, 0)

  return (
    <div className="min-h-screen px-4 md:px-8 py-6 bg-slate-50">

      {/* header */}
      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-800">Reports & Analytics</h1>
        <p className="text-sm text-slate-400 mt-0.5">Area, service and monthly breakdown</p>
      </div>

      {/* summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Revenue', value: `₹${totalAreaRev.toLocaleString('en-IN')}`, color: '#059669', bg: '#ECFDF5', icon: '💰' },
          { label: 'Total Orders',  value: totalOrders,      color: '#0891B2', bg: '#ECFEFF', icon: '📋' },
          { label: 'Areas Covered', value: areas.length,     color: '#7C3AED', bg: '#F5F3FF', icon: '📍' },
          { label: 'Best Area',     value: areas[0]?.area ?? '—', color: '#D97706', bg: '#FFFBEB', icon: '🏆' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-2xl p-4 border border-slate-100 hover:shadow-md transition-all hover:-translate-y-0.5"
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl mb-3" style={{ background: c.bg }}>{c.icon}</div>
            <p className="text-xl font-black text-slate-800 leading-none mb-1 truncate">{c.value}</p>
            <p className="text-xs text-slate-400">{c.label}</p>
          </div>
        ))}
      </div>

      {/* tabs */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap flex-shrink-0 transition-all active:scale-95 border"
            style={{
              background:  tab === t.key ? '#059669' : '#fff',
              color:       tab === t.key ? '#fff'    : '#64748B',
              borderColor: tab === t.key ? '#059669' : '#E2E8F0',
              boxShadow:   tab === t.key ? '0 4px 12px rgba(5,150,105,0.25)' : '0 1px 3px rgba(0,0,0,0.04)',
            }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* AREA */}
      {tab === 'area' && (
        <div className="space-y-3">
          {areas.length === 0 ? (
            <div className="rounded-2xl p-10 text-center bg-white border border-slate-100">
              <p className="text-2xl mb-2">📍</p><p className="text-slate-400">No area data yet</p>
            </div>
          ) : areas.map((a, i) => {
            const share  = totalAreaRev > 0 ? Math.round((a.totalRevenue / totalAreaRev) * 100) : 0
            const colors = ['#0891B2','#7C3AED','#D97706','#059669','#DB2777','#DC2626']
            const c      = colors[i % colors.length]
            return (
              <div key={a.area} className="bg-white rounded-2xl p-4 border border-slate-100 hover:shadow-md transition-all"
                style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                      style={{ background: `${c}15` }}>📍</div>
                    <div>
                      <p className="text-slate-800 font-bold">{a.area}</p>
                      <p className="text-xs text-slate-400">{a.city} · #{i+1} by revenue</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-lg leading-none" style={{ color: c }}>₹{a.totalRevenue.toLocaleString('en-IN')}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{share}% share</p>
                  </div>
                </div>
                <div className="h-1.5 rounded-full mb-3 overflow-hidden bg-slate-100">
                  <div className="h-full rounded-full transition-all" style={{ width: `${share}%`, background: c }}/>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { l: 'Orders',    v: a.totalOrders, cls: 'text-slate-700' },
                    { l: 'Completed', v: a.completed,   cls: 'text-green-600'  },
                    { l: 'Cancelled', v: a.cancelled,   cls: 'text-red-500'    },
                    { l: 'Avg Order', v: `₹${a.avgOrder.toLocaleString('en-IN')}`, cls: 'text-slate-500' },
                  ].map(s => (
                    <div key={s.l} className="text-center rounded-xl py-2 bg-slate-50 border border-slate-100">
                      <p className={`font-bold text-sm ${s.cls}`}>{s.v}</p>
                      <p className="text-[9px] text-slate-400 mt-0.5">{s.l}</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          {areas.length > 0 && (
            <div className="rounded-2xl p-4 bg-green-50 border border-green-200">
              <div className="flex items-center justify-between">
                <p className="text-slate-800 font-black">TOTAL</p>
                <p className="font-black text-lg text-green-700">₹{totalAreaRev.toLocaleString('en-IN')}</p>
              </div>
              <div className="flex gap-4 mt-2">
                <p className="text-xs text-slate-400">Orders: <span className="text-slate-700 font-bold">{areas.reduce((s,a)=>s+a.totalOrders,0)}</span></p>
                <p className="text-xs text-slate-400">Completed: <span className="text-green-600 font-bold">{areas.reduce((s,a)=>s+a.completed,0)}</span></p>
                <p className="text-xs text-slate-400">Cancelled: <span className="text-red-500 font-bold">{areas.reduce((s,a)=>s+a.cancelled,0)}</span></p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SERVICE */}
      {tab === 'service' && (
        <div className="space-y-3">
          {services.length === 0 ? (
            <div className="rounded-2xl p-10 text-center bg-white border border-slate-100">
              <p className="text-2xl mb-2">🧹</p><p className="text-slate-400">No service data yet</p>
            </div>
          ) : services.map((s, i) => {
            const share  = totalSvcRev > 0 ? Math.round((s.totalRevenue / totalSvcRev) * 100) : 0
            const colors = ['#7C3AED','#0891B2','#D97706','#059669','#DB2777','#DC2626']
            const c      = colors[i % colors.length]
            return (
              <div key={s.name} className="bg-white rounded-2xl p-4 border border-slate-100 hover:shadow-md transition-all"
                style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0" style={{ background: `${c}15` }}>🧹</div>
                    <div>
                      <p className="text-slate-800 font-bold text-sm">{s.name}</p>
                      <p className="text-xs text-slate-400">#{i+1} · {s.totalOrders} orders</p>
                    </div>
                  </div>
                  <p className="font-black text-lg" style={{ color: c }}>₹{s.totalRevenue.toLocaleString('en-IN')}</p>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden bg-slate-100 mb-2">
                  <div className="h-full rounded-full transition-all" style={{ width: `${share}%`, background: c }}/>
                </div>
                <div className="flex justify-between">
                  <p className="text-xs text-slate-400">Avg: <span className="text-slate-700 font-bold">₹{s.avgOrder.toLocaleString('en-IN')}</span></p>
                  <p className="text-xs font-bold" style={{ color: c }}>{share}% share</p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* MONTHLY */}
      {tab === 'monthly' && (
        <div className="space-y-3">
          {months.length === 0 ? (
            <div className="rounded-2xl p-10 text-center bg-white border border-slate-100">
              <p className="text-2xl mb-2">📅</p><p className="text-slate-400">No monthly data yet</p>
            </div>
          ) : months.map((m, i) => {
            const barW = Math.round((m.totalRevenue / maxMonthRev) * 100)
            const isTop = i === 0
            return (
              <div key={m.month} className="bg-white rounded-2xl p-4 border transition-all hover:shadow-md"
                style={{ borderColor: isTop ? '#6EE7B7' : '#F1F5F9', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    {isTop && <span className="text-sm">🏆</span>}
                    <div>
                      <p className="text-slate-800 font-bold">{m.month}</p>
                      <p className="text-xs text-slate-400">{m.totalOrders} orders completed</p>
                    </div>
                  </div>
                  <p className="font-black text-lg text-green-700">₹{m.totalRevenue.toLocaleString('en-IN')}</p>
                </div>
                <div className="h-2 rounded-full overflow-hidden bg-slate-100">
                  <div className="h-full rounded-full transition-all" style={{ width: `${barW}%`, background: isTop ? 'linear-gradient(90deg,#059669,#0891B2)' : '#6EE7B7' }}/>
                </div>
                <p className="text-xs text-slate-400 mt-1.5">
                  Avg: <span className="text-slate-600 font-bold">₹{m.totalOrders > 0 ? Math.round(m.totalRevenue / m.totalOrders).toLocaleString('en-IN') : 0}</span> per order
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
} 