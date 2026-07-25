import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET  /api/payroll/payouts?status=requested|approved|processing|paid|rejected|all
// POST /api/payroll/payouts  { id, action, reason?, method?, reference? }
//   action: 'approve' | 'reject' | 'processing' | 'paid'
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status') ?? 'requested'
  const workerId = req.nextUrl.searchParams.get('worker_id')
  const supabase = createServiceClient()

  let q = supabase
    .from('payout_requests')
    .select('id, worker_id, period_from, period_to, base_amount, order_amount, travel_amount, amount, status, method, reference, reject_reason, note, requested_at, reviewed_at, paid_at, users!worker_id(full_name, phone)')
    .order('requested_at', { ascending: false })
    .limit(100)

  if (status !== 'all') q = q.eq('status', status)
  if (workerId) q = q.eq('worker_id', workerId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const requests = (data ?? []).map((r: any) => ({
    id: r.id,
    worker_id: r.worker_id,
    name: r.users?.full_name ?? 'Worker',
    phone: r.users?.phone ?? '',
    from: r.period_from,
    to: r.period_to,
    base: Number(r.base_amount ?? 0),
    order: Number(r.order_amount ?? 0),
    travel: Number(r.travel_amount ?? 0),
    amount: Number(r.amount ?? 0),
    status: r.status,
    method: r.method,
    reference: r.reference,
    reject_reason: r.reject_reason,
    note: r.note,
    requested_at: r.requested_at,
    reviewed_at: r.reviewed_at,
    paid_at: r.paid_at,
  }))
  return NextResponse.json({ requests })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { id, action, reason, method, reference } = body || {}
  if (!id || !['approve', 'reject', 'processing', 'paid'].includes(action)) {
    return NextResponse.json({ error: 'id and valid action required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Re-verify the amount against live earnings before approving/paying,
  // so a request can't be paid for more than the worker actually earned.
  const { data: reqRow, error: rErr } = await supabase
    .from('payout_requests')
    .select('worker_id, period_from, period_to, amount, status')
    .eq('id', id)
    .maybeSingle()
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
  if (!reqRow) return NextResponse.json({ error: 'Request not found' }, { status: 404 })

  const patch: any = {}
  const now = new Date().toISOString()

  if (action === 'approve') {
    // cross-check live earnings for the period
    const { data: e } = await supabase.rpc('worker_earnings', {
      p_worker_id: reqRow.worker_id,
      p_from: reqRow.period_from,
      p_to: reqRow.period_to,
    })
    const live = Array.isArray(e) ? e[0] : e
    const liveTotal = Number(live?.total_amount ?? 0)
    patch.status = 'approved'
    patch.reviewed_at = now
    // refresh the snapshot to the verified live amount
    patch.base_amount = Number(live?.base_amount ?? 0)
    patch.order_amount = Number(live?.order_amount ?? 0)
    patch.travel_amount = Number(live?.travel_amount ?? 0)
    patch.amount = liveTotal
  } else if (action === 'reject') {
    patch.status = 'rejected'
    patch.reviewed_at = now
    patch.reject_reason = reason ?? null
  } else if (action === 'processing') {
    patch.status = 'processing'
  } else if (action === 'paid') {
    patch.status = 'paid'
    patch.paid_at = now
    patch.method = method ?? null
    patch.reference = reference ?? null
  }

  const { error } = await supabase.from('payout_requests').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}