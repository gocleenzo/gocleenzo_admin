import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GoogleAuth } from 'google-auth-library'

async function getFcmAccessToken(): Promise<string | null> {
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? '{}'
    const serviceAccount = JSON.parse(raw)
    if (!serviceAccount.project_id) return null
    const auth = new GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    })
    const client = await auth.getClient()
    const tokenRes = await client.getAccessToken()
    return tokenRes.token ?? null
  } catch (err) {
    console.error('Error getting FCM access token:', err)
    return null
  }
}

async function sendFcmNotification(
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<boolean> {
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? '{}'
    const serviceAccount = JSON.parse(raw)
    if (!serviceAccount.project_id) return false

    const accessToken = await getFcmAccessToken()
    if (!accessToken) return false

    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: fcmToken,
            notification: { title, body },
            data: data ?? {},
            android: {
              priority: 'high',
              notification: {
                sound: 'default',
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
              },
            },
            apns: {
              payload: { aps: { sound: 'default', badge: 1 } },
            },
          },
        }),
      }
    )

    if (!res.ok) {
      const err = await res.json()
      console.error('FCM send error:', err)
      return false
    }

    console.log('FCM notification sent successfully')
    return true
  } catch (err) {
    console.error('FCM error:', err)
    return false
  }
}

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
      console.log('Notification saved to DB')
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