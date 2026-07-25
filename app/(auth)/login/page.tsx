'use client'
// Customer login is handled by the Flutter mobile app.
// This page intentionally redirects away.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/admin') }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0A0F1E' }}>
      <p className="text-gray-400 text-sm">Redirecting…</p>
    </div>
  )
}
