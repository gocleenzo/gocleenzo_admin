import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET  /api/worker-approval                 -> count of pending (for badge)
// GET  /api/worker-approval?worker_id=UUID  -> that worker's onboarding detail
// POST /api/worker-approval { worker_id, action, reason? }
export async function GET(req: NextRequest) {
  const workerId = req.nextUrl.searchParams.get('worker_id')
  const supabase = createServiceClient()

  if (!workerId) {
    // list + count of pending applicants (no join — fetch users separately)
    const { data: prows, error } = await supabase
      .from('workers')
      .select('user_id, worker_status, submitted_at')
      .eq('worker_status', 'pending')
      .order('submitted_at', { ascending: true })
    if (error) return NextResponse.json({ error: error.message, pending: [], count: 0 }, { status: 200 })

    const ids = (prows ?? []).map((r: any) => r.user_id)
    let names: Record<string, any> = {}
    if (ids.length) {
      const { data: us } = await supabase.from('users').select('id, full_name, phone').in('id', ids)
      for (const u of us ?? []) names[u.id] = u
    }
    const rows = (prows ?? []).map((r: any) => ({
      user_id: r.user_id,
      full_name: names[r.user_id]?.full_name ?? 'Worker',
      phone: names[r.user_id]?.phone ?? '',
      submitted_at: r.submitted_at,
    }))
    return NextResponse.json({ pending: rows, count: rows.length })
  }

  // Single worker detail — fetch each table separately (no joins, robust).
  const { data: w, error: wErr } = await supabase
    .from('workers')
    .select('user_id, worker_status, status_reason, bank_verified, submitted_at, reviewed_at, available_hours, work_areas, work_areas_note, emergency_name, emergency_phone, emergency_relation, base_address')
    .eq('user_id', workerId)
    .maybeSingle()

  if (wErr) return NextResponse.json({ error: wErr.message }, { status: 200 })
  if (!w) return NextResponse.json({ error: 'No worker row for this id.' }, { status: 200 })

  const { data: u } = await supabase
    .from('users')
    .select('full_name, phone, email, gender')
    .eq('id', workerId)
    .maybeSingle()

  const { data: kyc } = await supabase
    .from('worker_kyc')
    .select('address, date_of_birth, marital_status, bank_holder, bank_account, bank_ifsc, upi_id, pan_number, aadhaar_number')
    .eq('worker_id', workerId)
    .maybeSingle()

  return NextResponse.json({
    status: w.worker_status ?? 'onboarding',
    reason: w.status_reason,
    bank_verified: w.bank_verified ?? false,
    submitted_at: w.submitted_at,
    reviewed_at: w.reviewed_at,
    profile: {
      full_name: u?.full_name ?? '',
      phone: u?.phone ?? '',
      email: u?.email ?? '',
      gender: u?.gender ?? '',
      address: kyc?.address ?? w.base_address ?? '',
      date_of_birth: kyc?.date_of_birth ?? '',
      marital_status: kyc?.marital_status ?? '',
      emergency_name: w.emergency_name ?? '',
      emergency_phone: w.emergency_phone ?? '',
      emergency_relation: w.emergency_relation ?? '',
      available_hours: w.available_hours ?? null,
      work_areas_note: w.work_areas_note ?? '',
      base_address: w.base_address ?? '',
    },
    bank: {
      holder: kyc?.bank_holder ?? '',
      account: kyc?.bank_account ?? '',
      ifsc: kyc?.bank_ifsc ?? '',
      upi: kyc?.upi_id ?? '',
      pan: kyc?.pan_number ?? '',
      aadhaar: kyc?.aadhaar_number ?? '',
    },
  })
}

export async function POST(req: NextRequest) {
  const { worker_id, action, reason } = await req.json().catch(() => ({}))
  if (!worker_id || !action) {
    return NextResponse.json({ error: 'worker_id and action required' }, { status: 400 })
  }
  const supabase = createServiceClient()
  const now = new Date().toISOString()

  let patch: any = {}
  switch (action) {
    case 'approve':
      patch = { worker_status: 'approved', status_reason: null, reviewed_at: now, is_verified: true }
      break
    case 'reject':
      patch = { worker_status: 'rejected', status_reason: reason || 'Please review your details and resubmit.', reviewed_at: now }
      break
    case 'bank_verify':
      patch = { bank_verified: true }
      break
    case 'bank_unverify':
      patch = { bank_verified: false }
      break
    default:
      return NextResponse.json({ error: 'invalid action' }, { status: 400 })
  }

  const { error } = await supabase.from('workers').update(patch).eq('user_id', worker_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}