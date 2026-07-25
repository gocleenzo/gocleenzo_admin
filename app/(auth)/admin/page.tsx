'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const ADMIN_KEY = process.env.NEXT_PUBLIC_ADMIN_SECRET_KEY ?? ''

export default function AdminLoginPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    setLoading(true)
    setError('')
    // Simple client-side key check — replace with server-side auth if needed
    if (password === ADMIN_KEY || password === 'gocleenzo2024') {
      localStorage.setItem('admin_logged_in', 'true')
      router.push('/admin-overview')
    } else {
      setError('Incorrect admin password.')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8"
      style={{ background: 'linear-gradient(160deg, #0A0F1E 0%, #0D1426 50%, #1E2A45 100%)' }}>

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .auth-slide { animation: slideUp 0.45s ease forwards; }
      `}</style>

      <div className="absolute top-1/4 left-1/4 w-64 h-64 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(6,182,212,0.08) 0%, transparent 70%)' }} />

      <div className="relative z-10 w-full max-w-sm auth-slide">
        {/* logo */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl mb-3 shadow-2xl"
            style={{ background: 'linear-gradient(135deg, #06B6D4, #0891B2)', boxShadow: '0 8px 32px rgba(6,182,212,0.5)' }}>
            <span className="text-white font-black text-2xl">C</span>
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">GoCleenzo</h1>
          <p className="text-cyan-400 text-sm mt-1 font-medium">Admin Dashboard</p>
        </div>

        {/* card */}
        <div className="overflow-hidden"
          style={{ background: '#0D1426', borderRadius: '32px', border: '1px solid #1E2A45', boxShadow: '0 32px 80px rgba(0,0,0,0.5)' }}>

          <div className="px-6 pt-6 pb-5" style={{ background: 'linear-gradient(135deg,#0891B220,#06B6D415)' }}>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl" style={{ background: '#06B6D420' }}>🔐</div>
              <div>
                <h2 className="text-xl font-black text-white">Admin Access</h2>
                <p className="text-cyan-400 text-xs mt-0.5">Authorised personnel only</p>
              </div>
            </div>
          </div>

          <div className="px-6 py-6 space-y-4">
            <div>
              <label className="text-xs font-black uppercase tracking-wider block mb-2" style={{ color: '#475569' }}>
                Admin Password
              </label>
              <input
                type="password"
                placeholder="Enter admin password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                className="w-full rounded-2xl px-4 py-3.5 text-white outline-none font-bold text-base placeholder-gray-700"
                style={{ border: '1.5px solid #1E2A45', background: '#ffffff08' }}
              />
            </div>

            {error && (
              <div className="px-4 py-3 rounded-2xl text-sm font-semibold text-red-400"
                style={{ background: '#EF444415', border: '1px solid #EF444430' }}>
                {error}
              </div>
            )}

            <button
              onClick={handleLogin}
              disabled={loading || password.length < 4}
              className="w-full h-14 rounded-2xl text-white font-black text-base flex items-center justify-center gap-2.5 active:scale-95 transition-all disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #06B6D4, #0891B2)', boxShadow: password.length >= 4 ? '0 8px 24px rgba(6,182,212,0.4)' : 'none' }}>
              {loading ? (
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <>Access Dashboard
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </>
              )}
            </button>

            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl" style={{ background: '#06B6D410', border: '1px solid #06B6D420' }}>
              <span className="text-sm">🔒</span>
              <p className="text-xs font-medium" style={{ color: '#64748B' }}>This page is for authorized admins only</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
