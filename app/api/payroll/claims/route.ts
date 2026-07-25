import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET  /api/referrals?status=joined|earned|paid|rejected|all
// POST /api/referrals { id, action: 'pay' | 'reject' }
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status') ?? 'earned'
  const workerId = req.nextUrl.searchParams.get('worker_id')
  const supabase = createServiceClient()

  let q = supabase
    .from('referrals')
    .select('id, referrer_id, referred_id, code_used, status, jobs_completed, reward_amount, earned_at, paid_at, created_at, referrer:users!referrer_id(full_name, phone), referred:users!referred_id(full_name, phone)')
    .order('created_at', { ascending: false })
    .limit(200)
  if (status !== 'all') q = q.eq('status', status)
  if (workerId) q = q.eq('referrer_id', workerId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    referrer: r.referrer?.full_name ?? 'Worker',
    referrer_phone: r.referrer?.phone ?? '',
    referred: r.referred?.full_name ?? 'Worker',
    referred_phone: r.referred?.phone ?? '',
    code: r.code_used,
    status: r.status,
    jobs: r.jobs_completed,
    amount: Number(r.reward_amount ?? 0),
    earned_at: r.earned_at,
    paid_at: r.paid_at,
    created_at: r.created_at,
  }))

  // totals
  const totalEarned = rows.filter(r => r.status === 'earned').reduce((s, r) => s + r.amount, 0)
  const totalPaid = rows.filter(r => r.status === 'paid').reduce((s, r) => s + r.amount, 0)

  return NextResponse.json({ rows, totalEarned, totalPaid })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { id, action } = body || {}
  if (!id || !['pay', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'id and valid action required' }, { status: 400 })
  }
  const supabase = createServiceClient()

  const patch: any =
    action === 'pay'
      ? { status: 'paid', paid_at: new Date().toISOString() }
      : { status: 'rejected' }

  const { error } = await supabase.from('referrals').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}