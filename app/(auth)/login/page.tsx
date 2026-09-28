'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin-auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Login failed')
        setLoading(false)
        return
      }
      if (data.role === 'assistant') {
        router.push('/assistant-dashboard')
      } else {
        router.push('/admin-overview')
      }
    } catch {
      setError('Could not connect. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(160deg, #0A0F1E 0%, #0D1426 50%, #1E2A45 100%)',
      fontFamily: 'system-ui, sans-serif', padding: 16,
    }}>
      <form onSubmit={handleSubmit} style={{
        background: '#0D1426', padding: 32, borderRadius: 32, width: 360,
        boxShadow: '0 32px 80px rgba(0,0,0,0.5)', border: '1px solid #1E2A45',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 24, margin: '0 auto 12px',
            background: 'linear-gradient(135deg, #06B6D4, #0891B2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 32px rgba(6,182,212,0.5)',
          }}>
            <span style={{ color: 'white', fontWeight: 900, fontSize: 26 }}>C</span>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: 'white', margin: 0 }}>GoCleenzo</h1>
          <p style={{ color: '#06B6D4', fontSize: 13, marginTop: 4, fontWeight: 600 }}>Admin Dashboard</p>
        </div>

        <input
          type="email" placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)} required
          style={{ width: '100%', padding: '14px 16px', marginBottom: 12, borderRadius: 16,
            border: '1.5px solid #1E2A45', background: '#ffffff08', color: 'white',
            fontSize: 14, boxSizing: 'border-box', outline: 'none' }}
        />
        <input
          type="password" placeholder="Password" value={password}
          onChange={(e) => setPassword(e.target.value)} required
          style={{ width: '100%', padding: '14px 16px', marginBottom: 16, borderRadius: 16,
            border: '1.5px solid #1E2A45', background: '#ffffff08', color: 'white',
            fontSize: 14, boxSizing: 'border-box', outline: 'none' }}
        />
        {error && (
          <div style={{ padding: '12px 16px', marginBottom: 16, borderRadius: 16,
            background: '#EF444415', border: '1px solid #EF444430' }}>
            <p style={{ color: '#F87171', fontSize: 12.5, fontWeight: 600, margin: 0 }}>{error}</p>
          </div>
        )}
        <button type="submit" disabled={loading} style={{
          width: '100%', padding: '14px 0', borderRadius: 16, border: 'none',
          background: loading ? '#334155' : 'linear-gradient(135deg, #06B6D4, #0891B2)',
          color: 'white', fontSize: 15, fontWeight: 900,
          cursor: loading ? 'default' : 'pointer',
          boxShadow: loading ? 'none' : '0 8px 24px rgba(6,182,212,0.4)',
        }}>
          {loading ? 'Signing in…' : 'Access Dashboard'}
        </button>
      </form>
    </div>
  )
}