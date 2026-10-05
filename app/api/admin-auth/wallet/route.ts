// app/api/admin-auth/wallet/route.ts
//
// Professional wallet — admin side.
//   GET                       → every professional: balance due, earned, paid
//   GET  ?worker_id=…         → one professional's full history (same as their app)
//   POST { worker_id, kind, amount, date, method, reference, note }
//                             → record a payout / advance / deduction / credit / opening balance
//                               (owner only; professional gets a notification for payouts)
//   DELETE ?txn_id=…          → remove an entry added in admin (owner only)
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { verifyAdminSession } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

const KINDS = ['payout', 'advance', 'deduction', 'credit', 'opening_balance'] as const
const METHODS = ['upi', 'bank', 'cash']

async function getSession(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  return token ? await verifyAdminSession(token) : null
}

export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const supabase = createServiceClient()
  const workerId = req.nextUrl.searchParams.get('worker_id')

  if (workerId) {
    const { data, error } = await supabase.rpc('worker_wallet', { p_worker_id: workerId, p_limit: 500 })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true, wallet: data })
  }

  const { data, error } = await supabase.rpc('admin_wallet_overview')
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, professionals: data ?? [], role: session.role })
}

export async function POST(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  if (session.role !== 'owner') {
    return NextResponse.json({ error: 'Only the owner can record payments' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const workerId = String(body?.worker_id ?? '')
  const kind = String(body?.kind ?? '') as (typeof KINDS)[number]
  const amount = Math.round(Number(body?.amount) * 100) / 100
  const date = typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null
  const method = body?.method ? String(body.method).toLowerCase() : null
  const reference = body?.reference ? String(body.reference).trim().slice(0, 100) : null
  const note = body?.note ? String(body.note).trim().slice(0, 300) : null

  if (!workerId) return NextResponse.json({ error: 'Choose a professional' }, { status: 400 })
  if (!KINDS.includes(kind)) return NextResponse.json({ error: 'Unknown entry type' }, { status: 400 })
  if (!Number.isFinite(amount) || amount <= 0 || amount > 500000) {
    return NextResponse.json({ error: 'Enter an amount between ₹1 and ₹5,00,000' }, { status: 400 })
  }
  if ((kind === 'payout' || kind === 'advance') && (!method || !METHODS.includes(method))) {
    return NextResponse.json({ error: 'Choose how it was paid (UPI, bank or cash)' }, { status: 400 })
  }
  if ((kind === 'deduction' || kind === 'credit') && !note) {
    return NextResponse.json({ error: 'Please write a reason' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('admin_wallet_add', {
    p_worker_id: workerId,
    p_kind: kind,
    p_amount: amount,
    p_date: date,
    p_method: method,
    p_reference: reference,
    p_note: note,
    p_created_by: session.id,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Let the professional know (never blocks saving)
  const rupees = `₹${amount.toLocaleString('en-IN')}`
  const message =
    kind === 'payout' ? { title: `💸 ${rupees} paid to you`, body: `Sent via ${method?.toUpperCase()}${reference ? ` · Ref ${reference}` : ''}. See your wallet for details.` }
    : kind === 'advance' ? { title: `⏩ ${rupees} advance paid to you`, body: `Sent via ${method?.toUpperCase()}. It will be adjusted from your next earnings.` }
    : kind === 'credit' ? { title: `🟢 ${rupees} added to your wallet`, body: note ?? '' }
    : kind === 'deduction' ? { title: `${rupees} deducted from your wallet`, body: note ?? '' }
    : null
  if (message) {
    try {
      await fetch(`${req.nextUrl.origin}/api/notifications/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: workerId,
          title: message.title,
          body: message.body,
          data: { type: 'wallet_update', kind },
        }),
      })
    } catch { /* notification is a bonus — the entry is already saved */ }
  }

  return NextResponse.json({ ok: true, entry: data })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  if (session.role !== 'owner') {
    return NextResponse.json({ error: 'Only the owner can remove entries' }, { status: 403 })
  }
  const txnId = req.nextUrl.searchParams.get('txn_id')
  if (!txnId) return NextResponse.json({ error: 'txn_id is required' }, { status: 400 })

  const supabase = createServiceClient()
  const { error } = await supabase.rpc('admin_wallet_delete', { p_txn_id: txnId })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}