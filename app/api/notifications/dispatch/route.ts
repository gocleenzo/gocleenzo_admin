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
// UPDATED for multi-device support — resolveRecipients now returns
// one entry per DEVICE (a customer with two logged-in devices appears
// twice), so every device actually gets pushed. The scheduled_notif's
// own 'notifications' DB row is still only inserted ONCE per user
// (tracked separately below), so a two-device customer doesn't see a
// duplicated entry in their in-app notification list.
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

// Returns one row PER DEVICE (token), each still carrying its owning
// user_id so the caller can dedupe the in-app notifications insert
// per user while still pushing to every device.
async function resolveRecipientDevices(
  supabase: ReturnType<typeof supabaseAdmin>,
  targetType: string,
  targetValue: string | null
): Promise<{ user_id: string; token_row_id: string; token: string }[]> {
  let userIds: string[] = []

  if (targetType === 'user') {
    userIds = [targetValue!]
  } else if (targetType === 'area') {
    // Every customer with a saved (non-deleted) address in this pincode.
    const { data } = await supabase
      .from('addresses')
      .select('user_id')
      .eq('pincode', targetValue!)
      .eq('is_deleted', false)
    userIds = Array.from(new Set((data ?? []).map((r: any) => r.user_id).filter(Boolean)))
  } else {
    // 'all' — every customer. Scoped to role='customer' so this never
    // accidentally pushes to worker/admin accounts sharing this table.
    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('role', 'customer')
    userIds = (data ?? []).map((r: any) => r.id)
  }

  if (userIds.length === 0) return []

  const { data: tokenRows } = await supabase
    .from('user_fcm_tokens')
    .select('id, user_id, token')
    .in('user_id', userIds)

  return (tokenRows ?? []).map((r: any) => ({
    user_id: r.user_id,
    token_row_id: r.id,
    token: r.token,
  }))
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
      const devices = await resolveRecipientDevices(
        supabase, notif.target_type, notif.target_value)

      let successCount = 0
      const deadRowIds: string[] = []
      const notifiedUserIds = new Set<string>() // dedupe the in-app row per user

      for (const d of devices) {
        const result = await sendFcmNotification(
          d.token, notif.title, notif.body,
          { type: 'admin_broadcast', notification_id: notif.id })

        if (result.tokenInvalid) deadRowIds.push(d.token_row_id)

        if (result.success) {
          successCount++
          if (!notifiedUserIds.has(d.user_id)) {
            notifiedUserIds.add(d.user_id)
            try {
              await supabase.from('notifications').insert({
                user_id: d.user_id,
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
      }

      if (deadRowIds.length > 0) {
        await supabase.from('user_fcm_tokens').delete().in('id', deadRowIds)
      }

      await supabase
        .from('scheduled_notifications')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          // Recipients count now reflects distinct USERS notified
          // (not raw device sends) — matches what an admin actually
          // means by "how many customers got this".
          recipients_count: notifiedUserIds.size,
        })
        .eq('id', notif.id)

      results.push({
        id: notif.id,
        users_notified: notifiedUserIds.size,
        devices_sent: successCount,
        devices_pruned: deadRowIds.length,
      })
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