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
// ============================================================================

function supabaseAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

async function resolveRecipientDevices(
  supabase: ReturnType<typeof supabaseAdmin>,
  targetType: string,
  targetValue: string | null
): Promise<{ user_id: string; token_row_id: string; token: string }[]> {
  let userIds: string[] = []

  if (targetType === 'user') {
    userIds = [targetValue!]
  } else if (targetType === 'area') {
    const { data, error } = await supabase
      .from('addresses')
      .select('user_id')
      .eq('pincode', targetValue!)
      .eq('is_deleted', false)
    if (error) throw new Error(`resolveRecipientDevices(area): ${error.message}`)
    userIds = Array.from(new Set((data ?? []).map((r: any) => r.user_id).filter(Boolean)))
  } else {
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('role', 'customer')
    if (error) throw new Error(`resolveRecipientDevices(all/users): ${error.message}`)
    userIds = (data ?? []).map((r: any) => r.id)
  }

  console.log(`resolveRecipientDevices: targetType=${targetType} matched ${userIds.length} userIds`)

  if (userIds.length === 0) return []

  const { data: tokenRows, error: tokenError } = await supabase
    .from('user_fcm_tokens')
    .select('id, user_id, token')
    .in('user_id', userIds)

  if (tokenError) throw new Error(`resolveRecipientDevices(tokens): ${tokenError.message}`)

  console.log(`resolveRecipientDevices: found ${tokenRows?.length ?? 0} device tokens for ${userIds.length} userIds`)

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
    .limit(20)

  if (dueError) {
    console.error('Dispatch: could not load due notifications', dueError)
    return NextResponse.json({ error: dueError.message }, { status: 500 })
  }

  const results: any[] = []

  for (const notif of due ?? []) {
    try {
      const devices = await resolveRecipientDevices(
        supabase, notif.target_type, notif.target_value)

      console.log(`Dispatch: notif ${notif.id} (${notif.target_type}) resolved ${devices.length} devices`)

      let successCount = 0
      const deadRowIds: string[] = []
      const notifiedUserIds = new Set<string>()
      const sendErrors: string[] = []

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
        } else {
          sendErrors.push(`token ${d.token_row_id}: failed (tokenInvalid=${result.tokenInvalid})`)
        }
      }

      if (deadRowIds.length > 0) {
        await supabase.from('user_fcm_tokens').delete().in('id', deadRowIds)
      }

      console.log(`Dispatch: notif ${notif.id} sent to ${successCount}/${devices.length} devices, ${notifiedUserIds.size} unique users, ${deadRowIds.length} dead tokens pruned`)
      if (sendErrors.length > 0) {
        console.error(`Dispatch: notif ${notif.id} had ${sendErrors.length} failed sends`, sendErrors.slice(0, 5))
      }

      await supabase
        .from('scheduled_notifications')
        .update({
          status: devices.length > 0 && successCount === 0 ? 'failed' : 'sent',
          sent_at: new Date().toISOString(),
          recipients_count: notifiedUserIds.size,
          error: devices.length > 0 && successCount === 0
            ? `All ${devices.length} device sends failed — check FCM credentials`
            : devices.length === 0
              ? 'No matching device tokens found for target audience'
              : null,
        })
        .eq('id', notif.id)

      results.push({
        id: notif.id,
        devices_resolved: devices.length,
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