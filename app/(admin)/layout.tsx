'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import SosWatcher from './sos_watcher'

const NAV = [
  { href: '/admin-overview',   emoji: '📊', label: 'Overview',   color: '#2563EB' },
  { href: '/admin-bookings',   emoji: '📋', label: 'Bookings',   color: '#7C3AED' },
  { href: '/admin-recurring',  emoji: '🔁', label: 'Recurring',  color: '#7C3AED' },
  { href: '/admin-workers',    emoji: '👷', label: 'Workers',    color: '#0891B2' },
  { href: '/admin-users',      emoji: '👥', label: 'Users',      color: '#4F46E5' },
  { href: '/admin-services',   emoji: '🧾', label: 'Services',   color: '#0891B2' },
  { href: '/admin-live-map',   emoji: '📍', label: 'Live Map',   color: '#0D9488' },
  { href: '/admin-coverage',   emoji: '🛰️', label: 'Coverage',   color: '#0891B2' },
  { href: '/admin-slots',      emoji: '🗓️', label: 'Slots',      color: '#0891B2' },
  { href: '/admin-areas',      emoji: '🗺️', label: 'Service Areas', color: '#0EA5E9' },
  { href: '/admin-zones',      emoji: '📐', label: 'Service Zones', color: '#059669' },
  { href: '/admin-reports',    emoji: '📈', label: 'Reports',    color: '#059669' },
  { href: '/admin-payroll',    emoji: '💰', label: 'Payroll',    color: '#0891B2' },
  { href: '/admin-tiers',      emoji: '🏆', label: 'Tiers',       color: '#D97706' },
  { href: '/admin-promos',     emoji: '🎟', label: 'Promos',     color: '#DB2777' },
  { href: '/admin-complaints', emoji: '⚠️', label: 'Complaints', color: '#DC2626' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [open,     setOpen]     = useState(false)
  const [liveJobs, setLiveJobs] = useState(0)
  const [pending,  setPending]  = useState(0)
  const [time,     setTime]     = useState('')
  const supabase = createClient()

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }))
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t)
  }, [])

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase.from('bookings').select('status')
      if (data) {
        setLiveJobs(data.filter(b => b.status === 'in_progress').length)
        setPending(data.filter(b => b.status === 'pending').length)
      }
    }
    fetch(); const t = setInterval(fetch, 20000); return () => clearInterval(t)
  }, [])

  const badge = (href: string) => {
    if (href === '/admin-bookings' && pending  > 0) return pending
    if (href === '/admin-overview' && liveJobs > 0) return liveJobs
    return null
  }

  const Sidebar = ({ onNav }: { onNav?: () => void }) => (
    <div className="flex flex-col h-full bg-white">
      {/* logo */}
      <div className="px-5 pt-6 pb-5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-white text-lg"
            style={{ background: 'linear-gradient(135deg,#06B6D4,#2563EB)' }}>C</div>
          <div>
            <p className="font-black text-gray-900 text-base leading-none">Cleenzo</p>
            <p className="text-[10px] text-gray-400 mt-0.5 font-semibold tracking-wider uppercase">Admin Suite</p>
          </div>
        </div>

        {/* time */}
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </span>
          <span className="text-xs font-bold text-blue-600">{time}</span>
        </div>
      </div>

      {/* alerts */}
      {(liveJobs > 0 || pending > 0) && (
        <div className="px-3 pt-3 space-y-2">
          {liveJobs > 0 && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-cyan-50 border border-cyan-100">
              <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse flex-shrink-0"/>
              <p className="text-xs font-bold text-cyan-700">{liveJobs} live job{liveJobs > 1 ? 's' : ''}</p>
            </div>
          )}
          {pending > 0 && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-100">
              <span className="text-xs">⏳</span>
              <p className="text-xs font-bold text-amber-700">{pending} need worker</p>
            </div>
          )}
        </div>
      )}

      {/* nav label */}
      <div className="px-5 pt-5 pb-2">
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Main Menu</p>
      </div>

      {/* nav */}
      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
        {NAV.map(item => {
          const isActive = pathname.startsWith(item.href)
          const b = badge(item.href)
          return (
            <Link key={item.href} href={item.href} onClick={onNav}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all group"
              style={{
                background: isActive ? `${item.color}10` : 'transparent',
                color:      isActive ? item.color : '#6B7280',
              }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base transition-all flex-shrink-0"
                style={{
                  background: isActive ? `${item.color}15` : '#F9FAFB',
                  border:     isActive ? `1px solid ${item.color}25` : '1px solid #F3F4F6',
                }}>
                {item.emoji}
              </div>
              <span className="flex-1 font-semibold">{item.label}</span>
              {b && (
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white flex-shrink-0"
                  style={{ background: item.color }}>
                  {b}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* footer */}
      <div className="px-3 pb-5 pt-3 border-t border-gray-100 mt-3">
        <div className="flex items-center gap-3 px-3 py-3 rounded-xl bg-gray-50">
          <div className="w-8 h-8 rounded-full flex items-center justify-center font-black text-sm text-white bg-gradient-to-br from-blue-500 to-purple-500 flex-shrink-0">A</div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-gray-900">Admin</p>
            <p className="text-[10px] text-gray-400">Full Access</p>
          </div>
          <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0"/>
        </div>
      </div>
    </div>
  )

  const active = NAV.find(n => pathname.startsWith(n.href))

  return (
    <div className="min-h-screen flex bg-gray-50">

      {/* GLOBAL SOS POPUP — shows on every admin page */}
      <SosWatcher />

      {/* desktop sidebar */}
      <aside className="hidden md:flex w-60 flex-col fixed h-full z-40 border-r border-gray-100 shadow-sm">
        <Sidebar/>
      </aside>

      {/* mobile overlay */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)}/>
          <aside className="absolute left-0 top-0 bottom-0 w-64 shadow-2xl">
            <Sidebar onNav={() => setOpen(false)}/>
          </aside>
        </div>
      )}

      {/* main */}
      <main className="flex-1 md:ml-60 flex flex-col min-h-screen">
        {/* mobile topbar */}
        <div className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 sticky top-0 z-30 shadow-sm">
          <button onClick={() => setOpen(true)}
            className="w-9 h-9 rounded-xl flex items-center justify-center bg-gray-100">
            <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center font-black text-sm text-white"
              style={{ background: 'linear-gradient(135deg,#06B6D4,#2563EB)' }}>C</div>
            <span className="text-gray-900 font-bold text-sm">{active?.label ?? 'Admin'}</span>
          </div>
          <div className="relative">
            <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center">
              <span>{active?.emoji ?? '📊'}</span>
            </div>
            {liveJobs > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black text-white bg-cyan-500 animate-pulse border-2 border-white">
                {liveJobs}
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 pb-24 md:pb-0">{children}</div>
      </main>

      {/* mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-100 shadow-lg">
        <div className="flex items-center justify-around px-1 py-2 overflow-x-auto">
          {NAV.map(item => {
            const isActive = pathname.startsWith(item.href)
            const b = badge(item.href)
            return (
              <Link key={item.href} href={item.href}
                className="relative flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-all flex-shrink-0"
                style={{ background: isActive ? `${item.color}10` : 'transparent' }}>
                <span className="text-lg leading-none">{item.emoji}</span>
                <span className="text-[9px] font-bold" style={{ color: isActive ? item.color : '#9CA3AF' }}>
                  {item.label}
                </span>
                {b && (
                  <span className="absolute -top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black text-white"
                    style={{ background: item.color }}>{b}</span>
                )}
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}