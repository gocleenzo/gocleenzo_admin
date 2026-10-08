// app/api/admin-auth/coverage-requests/route.ts
//
// "Notify me" requests from customers outside your service area —
// shown as demand pins on the admin Coverage map.
// Staff login required (this path is covered by middleware.ts, and
// checked again here). Customers' phone numbers never reach the apps.
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { verifyAdminSession } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  const session = token ? await verifyAdminSession(token) : null
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days') ?? 90) || 90, 1), 365)
  const since = new Date(Date.now() - days * 86400000).toISOString()

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('coverage_requests')
    .select('id, name, phone, latitude, longitude, pincode, area, full_address, reason, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2000)

  if (error) {
    const msg = error.message.includes('coverage_requests')
      ? 'Run coverage.sql in Supabase first.'
      : error.message
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  // assistants see requests, but not customers' phone numbers
  const rows = (data ?? []).map((r: any) =>
    session.role === 'owner' ? r : { ...r, phone: null })

  return NextResponse.json({ ok: true, requests: rows, days })
}