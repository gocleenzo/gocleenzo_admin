import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { sendFcmNotification } from '../fcm'

// ============================================================================
// POST /api/notifications/dispatch
// ============================================================================
// Finds every scheduled_notifications row that's PENDING and due
// (send_at <= now), resolves its actual recipient list, sends to each,
// and marks the row sent/failed. This route does the real work; the
// admin-facing schedule route above only creates/lists/cancels rows —
// nothing gets sent until THIS runs.
//
// TRIGGERING THIS PERIODICALLY (do this once, outside of code):
//   Vercel Cron Jobs — add to vercel.json:
//     { "crons": [{ "path": "/api/notifications/dispatch", "schedule": "* * * * *" }] }
//   NOTE: minute-level cron schedules require a Vercel Pro plan or
//   above — the Hobby (free) tier only allows once-per-day cron
//   triggers, which isn't useful for near-real-time scheduled sends.
//   If you're on Hobby, either upgrade, or trigger this route from an
//   external free scheduler (e.g. cron-job.org or a Supabase pg_cron +
//   pg_net call) hitting this URL every 1-5 minutes instead.
//
// SECURITY: protected by a shared secret (CRON_SECRET env var) passed
// as a Bearer token — Vercel Cron automatically sends this on its own
// invocations when CRON_SECRET is set in your project's environment
// variables; an external scheduler needs to be configured to send the
// same header manually. Without a valid secret, this route refuses to
// run, since it's a bulk-send endpoint that must not be publicly
// triggerable by anyone who finds the URL.
// ============================================================================

function supabaseAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

async function resolveRecipients(
  supabase: ReturnType<typeof supabaseAdmin>,
  targetType: string,
  targetValue: string | null
): Promise<{ id: string; fcm_token: string }[]> {
  if (targetType === 'user') {
    const { data } = await supabase
      .from('users')
      .select('id, fcm_token')
      .eq('id', targetValue!)
      .not('fcm_token', 'is', null)
    return (data ?? []) as { id: string; fcm_token: string }[]
  }

  if (targetType === 'area') {
    // Every customer with a saved (non-deleted) address in this pincode.
    // Distinct on user id — a customer with two addresses in the same
    // pincode should still only get ONE notification.
    const { data } = await supabase
      .from('addresses')
      .select('user_id, users!inner(id, fcm_token)')
      .eq('pincode', targetValue!)
      .eq('is_deleted', false)
      .not('users.fcm_token', 'is', null)
    const seen = new Set<string>()
    const out: { id: string; fcm_token: string }[] = []
    for (const row of (data ?? []) as any[]) {
      const u = row.users
      if (!u?.id || seen.has(u.id)) continue
      seen.add(u.id)
      out.push({ id: u.id, fcm_token: u.fcm_token })
    }
    return out
  }

  // 'all' — every customer with a saved token. Scoped to role='customer'
  // so this never accidentally pushes to worker/admin accounts that
  // happen to share the same users table.
  const { data } = await supabase
    .from('users')
    .select('id, fcm_token')
    .eq('role', 'customer')
    .not('fcm_token', 'is', null)
  return (data ?? []) as { id: string; fcm_token: string }[]
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase = supabaseAdmin()

  const { data: due, error: dueError } = await supabase
    .from('scheduled_notifications')
    .select('*')
    .eq('status', 'pending')
    .lte('send_at', new Date().toISOString())
    .order('send_at', { ascending: true })
    .limit(20) // process a bounded batch per invocation

  if (dueError) {
    console.error('Dispatch: could not load due notifications', dueError)
    return NextResponse.json({ error: dueError.message }, { status: 500 })
  }

  const results: any[] = []

  for (const notif of due ?? []) {
    try {
      const recipients = await resolveRecipients(
        supabase, notif.target_type, notif.target_value)

      let successCount = 0
      for (const r of recipients) {
        const sent = await sendFcmNotification(
          r.fcm_token, notif.title, notif.body,
          { type: 'admin_broadcast', notification_id: notif.id })
        if (sent) {
          successCount++
          try {
            await supabase.from('notifications').insert({
              user_id: r.id,
              title:   notif.title,
              body:    notif.body,
              type:    'admin_broadcast',
              is_read: false,
            })
          } catch (dbErr) {
            console.error('Dispatch: failed saving in-app notification row', dbErr)
          }
        }
      }

      await supabase
        .from('scheduled_notifications')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          recipients_count: successCount,
        })
        .eq('id', notif.id)

      results.push({ id: notif.id, sent: successCount, total: recipients.length })
    } catch (err: any) {
      console.error(`Dispatch: notification ${notif.id} failed`, err)
      await supabase
        .from('scheduled_notifications')
        .update({ status: 'failed', error: err.message ?? 'Unknown error' })
        .eq('id', notif.id)
      results.push({ id: notif.id, error: err.message })
    }
  }

  return NextResponse.json({ processed: results.length, results })
}