import { GoogleAuth } from 'google-auth-library'

// Shared by /api/notifications/send (single-user, order-triggered) and
// /api/notifications/dispatch (scheduled, any-audience) — identical
// send logic in one place so the two routes can never silently drift
// apart in how a push notification actually gets delivered.

export async function getFcmAccessToken(): Promise<string | null> {
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

export async function sendFcmNotification(
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

    return true
  } catch (err) {
    console.error('FCM error:', err)
    return false
  }
}