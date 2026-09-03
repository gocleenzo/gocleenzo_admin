import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// ═══════════════════════════════════════════════════════════════
// GET  /api/tiers?status=earned|paid|rejected|all&worker_id=X
// POST /api/tiers { id, action: 'pay'|'reject' }
// PUT  /api/tiers { tier, min_orders?, bonus_amount? }
//
// FIXED: this route now queries tier_rewards / tier_config — the
// table the worker app (worker_service.dart) actually reads and
// writes tier bonuses to. The PREVIOUS version of this route queried
// worker_tier_bonuses / worker_tier_config instead — a table that
// exists in the schema but is never actually populated by anything
// real — AND had no worker_id filter at all, so every admin request
// (regardless of which worker was asked for) returned the exact same
// unfiltered global list. That's why every worker in the payroll
// table showed an identical bonus amount — the filter parameter was
// simply never read.
// ═══════════════════════════════════════════════════════════════
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status') ?? 'earned'
  const workerId = req.nextUrl.searchParams.get('worker_id')
  const supabase = createServiceClient()

  let q = supabase
    .from('tier_rewards')
    .select('id, worker_id, tier, bonus_amount, orders_at, status, earned_at, paid_at, worker:users!worker_id(full_name, phone)')
    .order('earned_at', { ascending: false })
    .limit(300)
  if (status !== 'all') q = q.eq('status', status)
  if (workerId) q = q.eq('worker_id', workerId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: cfg } = await supabase
    .from('tier_config')
    .select('tier, rank, min_orders, bonus_amount, label')
    .order('rank', { ascending: true })

  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    worker: r.worker?.full_name ?? 'Worker',
    phone: r.worker?.phone ?? '',
    tier: r.tier,
    amount: Number(r.bonus_amount ?? 0),
    orders_at: r.orders_at,
    status: r.status,
    earned_at: r.earned_at,
    paid_at: r.paid_at,
  }))

  const totalEarned = rows.filter(r => r.status === 'earned').reduce((s, r) => s + r.amount, 0)
  const totalPaid = rows.filter(r => r.status === 'paid').reduce((s, r) => s + r.amount, 0)

  return NextResponse.json({ rows, config: cfg ?? [], totalEarned, totalPaid })
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
  const { error } = await supabase.from('tier_rewards').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function PUT(req: NextRequest) {
  const { tier, min_orders, bonus_amount } = await req.json().catch(() => ({}))
  if (!tier) return NextResponse.json({ error: 'tier required' }, { status: 400 })
  const supabase = createServiceClient()
  const patch: any = {}
  if (min_orders != null) patch.min_orders = Number(min_orders)
  if (bonus_amount != null) patch.bonus_amount = Number(bonus_amount)
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }
  const { error } = await supabase.from('tier_config').update(patch).eq('tier', tier)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}