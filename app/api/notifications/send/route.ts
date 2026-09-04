import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendFcmNotification } from '../fcm'

// UPDATED for multi-device support — previously read a single
// users.fcm_token column, so only the last-logged-in device ever got
// this push. Now sends to EVERY device row in user_fcm_tokens for
// this user, and deletes any token FCM reports as genuinely dead
// (uninstalled app, expired registration) so future sends don't keep
// retrying a device that's gone for good.

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { user_id, title, body, data } = await req.json()

    if (!user_id || !title || !body) {
      return NextResponse.json(
        { error: 'user_id, title and body are required' },
        { status: 400 })
    }

    const { data: userRow, error: userError } = await supabase
      .from('users')
      .select('id, full_name')
      .eq('id', user_id)
      .single()

    if (userError || !userRow) {
      return NextResponse.json(
        { success: false, reason: 'User not found' })
    }

    // ── Save notification to DB (once, regardless of device count) ──
    try {
      await supabase.from('notifications').insert({
        user_id:    user_id,
        title:      title,
        body:       body,
        type:       data?.type ?? 'general',
        booking_id: data?.booking_id ?? null,
        is_read:    false,
      })
    } catch (dbErr) {
      console.error('Failed to save notification to DB:', dbErr)
    }

    // ── Fetch every device this user is currently logged into ──────
    const { data: tokenRows } = await supabase
      .from('user_fcm_tokens')
      .select('id, token')
      .eq('user_id', user_id)

    if (!tokenRows || tokenRows.length === 0) {
      return NextResponse.json(
        { success: false, reason: 'No FCM token' })
    }

    // ── Send to every device, prune any that come back dead ────────
    let anySuccess = false
    const deadRowIds: string[] = []

    for (const row of tokenRows) {
      const result = await sendFcmNotification(row.token, title, body, data)
      if (result.success) anySuccess = true
      if (result.tokenInvalid) deadRowIds.push(row.id)
    }

    if (deadRowIds.length > 0) {
      await supabase.from('user_fcm_tokens').delete().in('id', deadRowIds)
    }

    return NextResponse.json({
      success: anySuccess,
      devices_sent: tokenRows.length - deadRowIds.length,
      devices_pruned: deadRowIds.length,
    })
  } catch (err: any) {
    console.error('Notification API error:', err)
    return NextResponse.json(
      { error: err.message }, { status: 500 })
  }
}