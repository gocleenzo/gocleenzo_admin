import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET  /api/payroll/payouts?status=requested|approved|processing|paid|rejected|all
//
// POST /api/payroll/payouts  { id, action, ... }
//   action: 'set_status'    { id, action: 'set_status', status, reason?, method?, reference? }
//           — moves the request to ANY status directly (not just the
//             next one in sequence). `reason` is required when status
//             is 'rejected'; `method`/`reference` are used when status
//             is 'paid'. Re-verifies live earnings and refreshes the
//             base/order/travel snapshot ONLY when moving into
//             'approved' for the first time from 'requested' — moving
//             between other statuses (e.g. correcting a mistaken
//             'paid' back to 'approved') does not re-run that check,
//             since by then the amount may already be a deliberate
//             admin override (see update_amount below).
//   action: 'update_amount' { id, action: 'update_amount', amount, reason }
//           — admin manually overrides the payout amount. `reason` is
//             REQUIRED. The very first time this is called for a
//             request, the current `amount` is preserved forever in
//             `original_amount` before being overwritten, so there's
//             always a record of what was originally requested/
//             verified, regardless of how many times it's adjusted
//             afterward.
//
//   Legacy actions 'approve' | 'reject' | 'processing' | 'paid' are
//   still accepted and simply mapped to the equivalent set_status call,
//   so existing integrations/bookmarked behavior keep working.
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status') ?? 'requested'
  const workerId = req.nextUrl.searchParams.get('worker_id')
  const supabase = createServiceClient()

  let q = supabase
    .from('payout_requests')
    .select(
      'id, worker_id, period_from, period_to, base_amount, order_amount, travel_amount, amount, ' +
      'original_amount, amount_adjusted_by_admin, adjustment_reason, ' +
      'status, method, reference, reject_reason, note, requested_at, reviewed_at, paid_at, users!worker_id(full_name, phone)'
    )
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
    original_amount: r.original_amount != null ? Number(r.original_amount) : null,
    amount_adjusted_by_admin: r.amount_adjusted_by_admin === true,
    adjustment_reason: r.adjustment_reason ?? null,
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

const VALID_STATUSES = ['requested', 'approved', 'processing', 'paid', 'rejected']

// Maps the old fixed-sequence action names onto the new free-status
// model, so any existing callers of the old API keep working exactly
// as before.
const LEGACY_ACTION_TO_STATUS: Record<string, string> = {
  approve: 'approved',
  reject: 'rejected',
  processing: 'processing',
  paid: 'paid',
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { id, action } = body || {}
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const supabase = createServiceClient()

  const { data: reqRow, error: rErr } = await supabase
    .from('payout_requests')
    .select('worker_id, period_from, period_to, amount, original_amount, status')
    .eq('id', id)
    .maybeSingle()
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
  if (!reqRow) return NextResponse.json({ error: 'Request not found' }, { status: 404 })

  // ── Amount override ──────────────────────────────────────────────
  if (action === 'update_amount') {
    const newAmount = Number(body.amount)
    const reason = (body.reason ?? '').toString().trim()
    if (!Number.isFinite(newAmount) || newAmount < 0) {
      return NextResponse.json({ error: 'A valid non-negative amount is required' }, { status: 400 })
    }
    if (!reason) {
      return NextResponse.json({ error: 'A reason is required when changing the payout amount' }, { status: 400 })
    }

    const patch: any = {
      amount: newAmount,
      amount_adjusted_by_admin: true,
      adjustment_reason: reason,
    }
    // Only snapshot the FIRST time this request is ever adjusted — if
    // original_amount is already set, a later adjustment must not
    // overwrite it with the previous (already-adjusted) amount.
    if (reqRow.original_amount == null) {
      patch.original_amount = reqRow.amount
    }

    const { error } = await supabase.from('payout_requests').update(patch).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // ── Status change (free transition to any status) ────────────────
  const targetStatus = action === 'set_status'
    ? body.status
    : LEGACY_ACTION_TO_STATUS[action]

  if (!targetStatus || !VALID_STATUSES.includes(targetStatus)) {
    return NextResponse.json({ error: 'A valid status is required' }, { status: 400 })
  }

  const reason = body.reason ?? null
  const method = body.method ?? null
  const reference = body.reference ?? null

  if (targetStatus === 'rejected' && !reason) {
    return NextResponse.json({ error: 'A reason is required to reject a payout' }, { status: 400 })
  }

  const patch: any = { status: targetStatus }
  const now = new Date().toISOString()

  // Cross-check against live earnings only on the ORIGINAL
  // requested -> approved transition, same as before — this is what
  // stops a request being approved for more than the worker actually
  // earned at approval time. Re-entering 'approved' later (e.g. after
  // correcting a wrong 'paid' back to 'approved') does not re-run this,
  // since the amount may by then be a deliberate admin override that
  // this check would otherwise silently clobber.
  if (targetStatus === 'approved' && reqRow.status === 'requested') {
    const { data: e } = await supabase.rpc('worker_earnings', {
      p_worker_id: reqRow.worker_id,
      p_from: reqRow.period_from,
      p_to: reqRow.period_to,
    })
    const live = Array.isArray(e) ? e[0] : e
    const liveTotal = Number(live?.total_amount ?? 0)
    patch.base_amount = Number(live?.base_amount ?? 0)
    patch.order_amount = Number(live?.order_amount ?? 0)
    patch.travel_amount = Number(live?.travel_amount ?? 0)
    patch.amount = liveTotal
    if (reqRow.original_amount == null) patch.original_amount = liveTotal
  }

  if (targetStatus !== reqRow.status && reqRow.status === 'requested') {
    patch.reviewed_at = now
  }
  if (targetStatus === 'rejected') {
    patch.reject_reason = reason
  }
  if (targetStatus === 'paid') {
    patch.paid_at = now
    if (method) patch.method = method
    if (reference) patch.reference = reference
  }

  const { error } = await supabase.from('payout_requests').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}