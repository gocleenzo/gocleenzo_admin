import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/tiers?status=earned|paid|rejected|all
// Returns { rows, config, totalEarned, totalPaid } — matches exactly what
// admin-tiers/page.tsx expects (Row[] and Cfg[] shapes).
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status') ?? 'earned'
  const supabase = createServiceClient()

  const { data: config, error: configError } = await supabase
    .from('worker_tier_config')
    .select('tier, rank, min_orders, bonus_amount, label')
    .order('rank')

  if (configError) {
    return NextResponse.json({ error: configError.message }, { status: 500 })
  }

  let q = supabase
    .from('worker_tier_bonuses')
    .select('id, worker_id, tier, amount, orders_at, status, earned_at, paid_at, users!worker_id(full_name, phone)')
    .order('earned_at', { ascending: false })
    .limit(200)

  if (status !== 'all') q = q.eq('status', status)

  const { data: bonusRows, error: bonusError } = await q
  if (bonusError) {
    return NextResponse.json({ error: bonusError.message }, { status: 500 })
  }

  const rows = (bonusRows ?? []).map((r: any) => ({
    id: r.id,
    worker: r.users?.full_name ?? 'Worker',
    phone: r.users?.phone ?? '',
    tier: r.tier,
    amount: Number(r.amount ?? 0),
    orders_at: r.orders_at,
    status: r.status,
    earned_at: r.earned_at,
    paid_at: r.paid_at,
  }))

  // Totals always reflect ALL earned/paid regardless of the current
  // filter — matching the summary cards at the top of the page, which
  // should stay stable as the operator flips between tabs.
  const [{ data: earnedRows }, { data: paidRows }] = await Promise.all([
    supabase.from('worker_tier_bonuses').select('amount').eq('status', 'earned'),
    supabase.from('worker_tier_bonuses').select('amount').eq('status', 'paid'),
  ])
  const totalEarned = (earnedRows ?? []).reduce((s, r: any) => s + Number(r.amount ?? 0), 0)
  const totalPaid   = (paidRows ?? []).reduce((s, r: any) => s + Number(r.amount ?? 0), 0)

  return NextResponse.json({ rows, config: config ?? [], totalEarned, totalPaid })
}

// POST /api/tiers  { id, action: 'pay' | 'reject' }
// Marks a single earned bonus as paid or rejected.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const id = body?.id
  const action = body?.action

  if (!id || !['pay', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'id and valid action (pay|reject) required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const now = new Date().toISOString()
  const patch: Record<string, any> = action === 'pay'
    ? { status: 'paid', paid_at: now }
    : { status: 'rejected', rejected_at: now }

  const { error } = await supabase.from('worker_tier_bonuses').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// PUT /api/tiers  { tier, min_orders, bonus_amount }
// Edits one tier's threshold/bonus from the "Tier configuration" panel.
// Values arrive as strings from the input fields — coerced to numbers here.
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const tier = body?.tier
  const minOrders = Number(body?.min_orders)
  const bonusAmount = Number(body?.bonus_amount)

  if (!tier || !Number.isFinite(minOrders) || !Number.isFinite(bonusAmount)) {
    return NextResponse.json({ error: 'tier, min_orders and bonus_amount required' }, { status: 400 })
  }
  if (minOrders < 0 || bonusAmount < 0) {
    return NextResponse.json({ error: 'Values cannot be negative' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('worker_tier_config')
    .update({ min_orders: minOrders, bonus_amount: bonusAmount, updated_at: new Date().toISOString() })
    .eq('tier', tier)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}