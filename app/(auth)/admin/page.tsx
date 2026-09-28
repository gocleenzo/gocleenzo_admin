'use client'
// Deprecated: the old client-side-only password gate lived here.
// Real server-side auth now lives at /login + middleware.ts.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function DeprecatedAdminGate() {
  const router = useRouter()
  useEffect(() => { router.replace('/login') }, [router])
  return null
}