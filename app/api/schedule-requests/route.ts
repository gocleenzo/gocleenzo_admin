import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET  /api/schedule-requests?status=pending|approved|rejected|all&worker_id=<uuid>
//      -> { requests: [...], count: n }
//      With ?worker_id it also returns that worker's CURRENT live schedule
//      and, for a pending request, the booking conflicts it would cause.
//
// POST /api/schedule-requests  { id, action, reason? }
//      action: 'approve' | 'reject'
//      'approve' calls approve_schedule_request() which refuses if the change
//      would break existing bookings.

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status') ?? 'pending'
  const workerId = req.nextUrl.searchParams.get('worker_id')
  const supabase = createServiceClient()

  let q = supabase
    .from('worker_schedule_requests')
    .select('id, worker_id, proposed, status, net_week_mins, note, reject_reason, requested_at, reviewed_at')
    .order('requested_at', { ascending: false })
    .limit(200)

  if (status !== 'all') q = q.eq('status', status)
  if (workerId) q = q.eq('worker_id', workerId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = data ?? []

  // Attach worker names (fetched separately — no joins, matching the
  // pattern used by the worker-approval route).
  const ids = Array.from(new Set(rows.map((r: any) => r.worker_id)))
  const nameMap: Record<string, { name: string; phone: string }> = {}
  if (ids.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, full_name, phone')
      .in('id', ids)
    for (const u of users ?? []) {
      nameMap[(u as any).id] = {
        name: (u as any).full_name ?? 'Worker',
        phone: (u as any).phone ?? '',
      }
    }
  }

  const requests = rows.map((r: any) => ({
    id: r.id,
    worker_id: r.worker_id,
    name: nameMap[r.worker_id]?.name ?? 'Worker',
    phone: nameMap[r.worker_id]?.phone ?? '',
    proposed: r.proposed,
    status: r.status,
    net_week_mins: r.net_week_mins ?? 0,
    note: r.note,
    reject_reason: r.reject_reason,
    requested_at: r.requested_at,
    reviewed_at: r.reviewed_at,
  }))

  // Per-worker extras: their live schedule + conflicts for a pending request.
  let current: any = null
  let conflicts: any[] = []
  if (workerId) {
    const { data: w } = await supabase
      .from('workers')
      .select('schedule')
      .eq('user_id', workerId)
      .maybeSingle()
    current = (w as any)?.schedule ?? null

    const pending = requests.find((r) => r.status === 'pending')
    if (pending) {
      const { data: cf } = await supabase.rpc('schedule_conflicts', {
        p_worker_id: workerId,
        p_proposed: pending.proposed,
      })
      conflicts = (cf as any[]) ?? []
    }
  }

  // Count of everything still awaiting review (for the header badge).
  const { count } = await supabase
    .from('worker_schedule_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')

  return NextResponse.json({
    requests,
    current,
    conflicts,
    count: count ?? 0,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { id, action, reason } = body ?? {}
  if (!id || !action) {
    return NextResponse.json({ error: 'id and action are required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  if (action === 'approve') {
    // The DB function re-checks conflicts and only then applies the schedule.
    const { data, error } = await supabase.rpc('approve_schedule_request', {
      p_request_id: id,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const res = (data ?? {}) as any
    if (res.success !== true) {
      return NextResponse.json(
        {
          error:
            res.reason === 'conflicts'
              ? `Cannot approve: ${res.count} existing booking(s) would break.`
              : res.reason === 'not_pending'
              ? 'This request is no longer pending.'
              : 'Request not found.',
          reason: res.reason,
          count: res.count ?? 0,
        },
        { status: 409 }
      )
    }
    return NextResponse.json({ success: true })
  }

  if (action === 'reject') {
    const { error } = await supabase
      .from('worker_schedule_requests')
      .update({
        status: 'rejected',
        reject_reason: reason ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'pending')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}