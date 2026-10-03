// app/api/admin-auth/suggest-jobs/route.ts
//
// "Nearby next jobs" for a professional on a given day — powers the
// suggestions popup in the admin Bookings screen. Checks the admin
// login itself (API routes aren't covered by middleware.ts), then asks
// the database for unassigned bookings that fit that professional's
// day, closest to their previous job first.
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { verifyAdminSession } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  const session = token ? await verifyAdminSession(token) : null
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workerId = req.nextUrl.searchParams.get('worker_id')
  const date = req.nextUrl.searchParams.get('date') // YYYY-MM-DD (IST)
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '5')

  if (!workerId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'worker_id and date (YYYY-MM-DD) are required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('admin_suggest_jobs_for_worker', {
    p_worker_id: workerId,
    p_date: date,
    p_limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 20) : 5,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ suggestions: data ?? [] })
}