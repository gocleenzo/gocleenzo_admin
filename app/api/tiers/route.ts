import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET  /api/payroll/claims?status=pending|approved|rejected|all
// POST /api/payroll/claims  { id, action: 'approve'|'reject', reason? }
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status') ?? 'pending'
  const workerId = req.nextUrl.searchParams.get('worker_id')
  const supabase = createServiceClient()

  let q = supabase
    .from('travel_claims')
    .select('id, worker_id, claim_date, mode, photo_url, amount, status, note, reject_reason, created_at, reviewed_at, users!worker_id(full_name, phone)')
    .order('created_at', { ascending: false })
    .limit(100)

  if (status !== 'all') q = q.eq('status', status)
  if (workerId) q = q.eq('worker_id', workerId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const claims = (data ?? []).map((r: any) => ({
    id: r.id,
    worker_id: r.worker_id,
    name: r.users?.full_name ?? 'Worker',
    phone: r.users?.phone ?? '',
    date: r.claim_date,
    mode: r.mode,
    photo: r.photo_url,
    amount: Number(r.amount ?? 0),
    status: r.status,
    note: r.note,
    reject_reason: r.reject_reason,
    created_at: r.created_at,
    reviewed_at: r.reviewed_at,
  }))
  return NextResponse.json({ claims })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const id = body?.id
  const action = body?.action
  const reason = body?.reason ?? null

  if (!id || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'id and valid action required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const patch: any = {
    status: action === 'approve' ? 'approved' : 'rejected',
    reviewed_at: new Date().toISOString(),
  }
  if (action === 'reject') patch.reject_reason = reason

  const { error } = await supabase.from('travel_claims').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}