import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// ═══════════════════════════════════════════════════════════════
// GET  /api/referrals?status=joined|earned|paid|rejected|all&worker_id=X
// POST /api/referrals { id, action: 'pay'|'reject' }
//
// Built to mirror the same fix just applied to /api/tiers — the
// `worker_id` param filters by referrer_id (the worker who OWNS the
// referral and earns the reward, not the person they referred), so
// each worker's row in the admin payroll table only ever reflects
// their own referrals. If you have an existing version of this
// route elsewhere in the project, diff against it before deploying
// this — this was reconstructed from the known `referrals` table
// schema (referrer_id, referred_id, code_used, status, reward_amount,
// created_at) rather than an edit of a file actually seen, since the
// real route.ts couldn't be located.
// ═══════════════════════════════════════════════════════════════
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status') ?? 'earned'
  const workerId = req.nextUrl.searchParams.get('worker_id')
  const supabase = createServiceClient()

  let q = supabase
    .from('referrals')
    .select(`
      id, referrer_id, referred_id, code_used, status, reward_amount, jobs_completed,
      earned_at, paid_at, created_at,
      referrer:users!referrer_id(full_name, phone),
      referred:users!referred_id(full_name)
    `)
    .order('created_at', { ascending: false })
    .limit(300)
  if (status !== 'all') q = q.eq('status', status)
  // worker_id filters by REFERRER — the worker who owns this referral
  // and earns the reward, not the person they referred.
  if (workerId) q = q.eq('referrer_id', workerId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    referrer: r.referrer?.full_name ?? 'Worker',
    referrer_phone: r.referrer?.phone ?? '',
    referred: r.referred?.full_name ?? 'New worker',
    code: r.code_used ?? '',
    status: r.status,
    jobs: r.jobs_completed ?? 0,
    amount: Number(r.reward_amount ?? 0),
    earned_at: r.earned_at,
    paid_at: r.paid_at,
    created_at: r.created_at,
  }))

  const totalEarned = rows.filter(r => r.status === 'earned').reduce((s, r) => s + r.amount, 0)
  const totalPaid = rows.filter(r => r.status === 'paid').reduce((s, r) => s + r.amount, 0)

  return NextResponse.json({ referrals: rows, rows, totalEarned, totalPaid })
}

export async function POST(req: NextRequest) {
  const { id, action } = await req.json().catch(() => ({}))
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