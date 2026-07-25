import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'

// Always fresh, never cached.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const supabase = createServiceClient()

  const [{ data, error }, { data: activeJobs }] = await Promise.all([
    supabase
      .from('workers')
      .select('user_id, current_lat, current_lng, location_updated_at, is_verified, is_available, schedule, users(full_name)')
      .not('current_lat', 'is', null),
    supabase
      .from('bookings')
      .select('worker_id')
      .eq('status', 'in_progress'),
  ])

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const busy = new Set<string>()
  ;(activeJobs ?? []).forEach((b: any) => { if (b.worker_id) busy.add(b.worker_id) })

  const workers = (data ?? []).map((r: any) => ({
    user_id: r.user_id,
    name: r.users?.full_name ?? 'Worker',
    lat: r.current_lat as number,
    lng: r.current_lng as number,
    updatedAt: r.location_updated_at as string | null,
    verified: !!r.is_verified,
    available: !!r.is_available,
    busy: busy.has(r.user_id),
    schedule: r.schedule ?? null,
  }))

  return NextResponse.json({ workers })
}