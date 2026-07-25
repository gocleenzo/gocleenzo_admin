import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/payroll/earnings?from=YYYY-MM-DD&to=YYYY-MM-DD
//     -> all workers payroll for the range
// GET /api/payroll/earnings?worker_id=UUID&from=...&to=...
//     -> single worker breakdown
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const from = sp.get('from')
  const to = sp.get('to')
  const workerId = sp.get('worker_id')

  if (!from || !to) {
    return NextResponse.json({ error: 'from and to required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  if (workerId) {
    const { data, error } = await supabase.rpc('worker_earnings', {
      p_worker_id: workerId,
      p_from: from,
      p_to: to,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const row = Array.isArray(data) ? data[0] : data
    return NextResponse.json({ earning: row ?? null })
  }

  const { data, error } = await supabase.rpc('payroll_all', {
    p_from: from,
    p_to: to,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const workers = (data ?? []).map((r: any) => ({
    worker_id: r.worker_id,
    name: r.full_name ?? 'Worker',
    phone: r.phone ?? '',
    verified: !!r.is_verified,
    base: Number(r.base_amount ?? 0),
    order: Number(r.order_amount ?? 0),
    travel: Number(r.travel_amount ?? 0),
    total: Number(r.total_amount ?? 0),
    shiftHours: Number(r.shift_hours ?? 0),
    orderHours: Number(r.order_hours ?? 0),
    travelDays: Number(r.travel_days ?? 0),
  }))

  const grand = workers.reduce(
    (a: any, w: any) => ({
      base: a.base + w.base,
      order: a.order + w.order,
      travel: a.travel + w.travel,
      total: a.total + w.total,
    }),
    { base: 0, order: 0, travel: 0, total: 0 }
  )

  return NextResponse.json({ workers, grand })
}