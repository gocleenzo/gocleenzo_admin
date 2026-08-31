import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendFcmNotification } from '../fcm'

// Single-user, immediate notification — used by order-status triggers
// elsewhere in the app. Unchanged behavior from before; now just calls
// the shared sendFcmNotification helper (see ../fcm.ts) instead of a
// local copy, so this and /api/notifications/dispatch can never
// silently diverge in how a push actually gets sent.

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { user_id, title, body, data } = await req.json()

    if (!user_id || !title || !body) {
      return NextResponse.json(
        { error: 'user_id, title and body are required' },
        { status: 400 })
    }

    // Get customer FCM token
    const { data: userData, error } = await supabase
      .from('users')
      .select('fcm_token, full_name')
      .eq('id', user_id)
      .single()

    if (error || !userData) {
      return NextResponse.json(
        { success: false, reason: 'User not found' })
    }

    // ── Save notification to DB ───────────────────────────
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
      // Don't fail the whole request if DB save fails
    }

    // ── Send FCM push notification ────────────────────────
    if (!userData.fcm_token) {
      return NextResponse.json(
        { success: false, reason: 'No FCM token' })
    }

    const sent = await sendFcmNotification(
      userData.fcm_token, title, body, data)

    return NextResponse.json({ success: sent })
  } catch (err: any) {
    console.error('Notification API error:', err)
    return NextResponse.json(
      { error: err.message }, { status: 500 })
  }
}