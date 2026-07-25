import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET  /api/sos            -> list active (or ?all=1 for recent history)
// POST /api/sos  {id}      -> resolve an alert
export async function GET(req: NextRequest) {
  const all = req.nextUrl.searchParams.get('all')
  const supabase = createServiceClient()

  let q = supabase
    .from('sos_alerts')
    .select('id, worker_id, lat, lng, booking_id, status, note, created_at, resolved_at, users!worker_id(full_name, phone)')
    .order('created_at', { ascending: false })

  if (all) {
    q = q.limit(50)
  } else {
    q = q.eq('status', 'active').limit(20)
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const alerts = (data ?? []).map((r: any) => ({
    id: r.id,
    worker_id: r.worker_id,
    name: r.users?.full_name ?? 'Worker',
    phone: r.users?.phone ?? '',
    lat: r.lat as number | null,
    lng: r.lng as number | null,
    booking_id: r.booking_id,
    status: r.status,
    note: r.note,
    created_at: r.created_at,
    resolved_at: r.resolved_at,
  }))
  return NextResponse.json({ alerts })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const id = body?.id
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('sos_alerts')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}