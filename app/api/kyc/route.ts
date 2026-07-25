import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/kyc                      -> list all workers' KYC (summary)
// GET /api/kyc?worker_id=UUID       -> full detail incl. signed doc URLs + consents
// POST /api/kyc { worker_id, action:'verify'|'reject', reason? }
export async function GET(req: NextRequest) {
  const workerId = req.nextUrl.searchParams.get('worker_id')
  const supabase = createServiceClient()

  if (workerId) {
    const { data: k, error } = await supabase
      .from('worker_kyc')
      .select('*, users!worker_id(full_name, phone, email, gender)')
      .eq('worker_id', workerId)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!k) return NextResponse.json({ kyc: null })

    // sign private doc paths so admin can view them (short-lived)
    const paths: Record<string, string | null> = {
      pan: k.pan_path,
      aadhaar_front: k.aadhaar_front_path,
      aadhaar_back: k.aadhaar_back_path,
      photo: k.photo_path,
      signature: k.signature_path,
    }
    const urls: Record<string, string | null> = {}
    for (const [key, p] of Object.entries(paths)) {
      if (p) {
        const { data: signed } = await supabase.storage.from('kyc').createSignedUrl(p, 300)
        urls[key] = signed?.signedUrl ?? null
      } else {
        urls[key] = null
      }
    }

    const { data: consents } = await supabase
      .from('worker_consents')
      .select('doc_type, doc_version, accepted_at')
      .eq('worker_id', workerId)
      .order('accepted_at', { ascending: false })

    return NextResponse.json({
      kyc: {
        worker_id: k.worker_id,
        name: k.users?.full_name ?? 'Worker',
        phone: k.users?.phone ?? '',
        email: k.users?.email ?? '',
        gender: k.users?.gender ?? '',
        bank_holder: k.bank_holder,
        bank_account: k.bank_account,
        bank_ifsc: k.bank_ifsc,
        upi_id: k.upi_id,
        pan_number: k.pan_number,
        aadhaar_number: k.aadhaar_number,
        date_of_birth: k.date_of_birth,
        marital_status: k.marital_status,
        number_of_kids: k.number_of_kids,
        languages: k.languages ?? [],
        status: k.kyc_status,
        reject_reason: k.reject_reason,
        submitted_at: k.submitted_at,
        reviewed_at: k.reviewed_at,
      },
      urls,
      consents: consents ?? [],
    })
  }

  // list summary
  const { data, error } = await supabase
    .from('worker_kyc')
    .select('worker_id, kyc_status, bank_account, pan_number, submitted_at, users!worker_id(full_name, phone)')
    .order('submitted_at', { ascending: false, nullsFirst: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const list = (data ?? []).map((k: any) => ({
    worker_id: k.worker_id,
    name: k.users?.full_name ?? 'Worker',
    phone: k.users?.phone ?? '',
    status: k.kyc_status,
    hasBank: !!k.bank_account,
    hasPan: !!k.pan_number,
    submitted_at: k.submitted_at,
  }))
  return NextResponse.json({ list })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { worker_id, action, reason } = body || {}
  if (!worker_id || !['verify', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'worker_id and valid action required' }, { status: 400 })
  }
  const supabase = createServiceClient()

  const patch: any = {
    kyc_status: action === 'verify' ? 'verified' : 'rejected',
    reviewed_at: new Date().toISOString(),
    reject_reason: action === 'reject' ? (reason ?? null) : null,
  }
  const { error } = await supabase.from('worker_kyc').update(patch).eq('worker_id', worker_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // also reflect on the workers.is_verified flag (used across the app/maps)
  if (action === 'verify') {
    await supabase.from('workers').update({ is_verified: true }).eq('user_id', worker_id)
  } else {
    await supabase.from('workers').update({ is_verified: false }).eq('user_id', worker_id)
  }

  return NextResponse.json({ ok: true })
}