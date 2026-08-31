import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// ============================================================================
// /api/notifications/schedule
// ============================================================================
// Admin-facing CRUD for scheduled_notifications — creating, listing, and
// cancelling entries. Actual SENDING happens separately in
// /api/notifications/dispatch, triggered periodically (see that file's
// header comment for the Vercel Cron setup).
//
// POST   -> create a new (pending) scheduled notification
// GET    -> list scheduled notifications (most recent first)
// DELETE -> cancel a PENDING one (?id=<uuid>) — no-op if already sent
// ============================================================================

function supabaseAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const title       = String(body?.title ?? '').trim()
  const messageBody = String(body?.body ?? '').trim()
  const targetType  = String(body?.target_type ?? '')
  const targetValue = body?.target_value ? String(body.target_value) : null
  const sendAt      = body?.send_at ? new Date(body.send_at) : new Date()
  const createdBy   = body?.created_by ? String(body.created_by) : null

  if (!title || !messageBody) {
    return NextResponse.json({ error: 'title and body are required' }, { status: 400 })
  }
  if (!['all', 'area', 'user'].includes(targetType)) {
    return NextResponse.json({ error: 'target_type must be all, area, or user' }, { status: 400 })
  }
  if ((targetType === 'area' || targetType === 'user') && !targetValue) {
    return NextResponse.json({ error: 'target_value is required for area/user targeting' }, { status: 400 })
  }
  if (isNaN(sendAt.getTime())) {
    return NextResponse.json({ error: 'send_at is not a valid date' }, { status: 400 })
  }

  const supabase = supabaseAdmin()
  const { data, error } = await supabase
    .from('scheduled_notifications')
    .insert({
      title,
      body: messageBody,
      target_type: targetType,
      target_value: targetValue,
      send_at: sendAt.toISOString(),
      created_by: createdBy,
    })
    .select()
    .single()

  if (error) {
    console.error('Create scheduled notification error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ notification: data })
}

export async function GET() {
  const supabase = supabaseAdmin()
  const { data, error } = await supabase
    .from('scheduled_notifications')
    .select('*')
    .order('send_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('List scheduled notifications error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ notifications: data })
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id query param is required' }, { status: 400 })
  }

  const supabase = supabaseAdmin()
  // Only ever cancels a PENDING row — a notification already sent (or
  // already cancelled/failed) is left untouched, so this can't be used
  // to "un-send" something or hide a failure after the fact.
  const { data, error } = await supabase
    .from('scheduled_notifications')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('status', 'pending')
    .select()
    .maybeSingle()

  if (error) {
    console.error('Cancel scheduled notification error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Notification not found or no longer pending' }, { status: 404 })
  }

  return NextResponse.json({ notification: data })
}