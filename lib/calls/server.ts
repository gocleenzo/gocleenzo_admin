// ─────────────────────────────────────────────────────────────────────
// Cleenzo in-app calling — shared server helpers (used by /api/calls/*)
//
// • Works out WHO is calling from the app's login token (Firebase phone
//   login; Supabase login as a fallback) — never from anything the app
//   could simply type in.
// • Checks the booking rules: a professional is assigned, the booking is
//   active, and it is no earlier than 30 minutes before the slot.
// • Makes a short-lived Agora pass for one booking's private channel.
//
// Needs in Vercel → Settings → Environment Variables:
//   AGORA_APP_ID, AGORA_APP_CERTIFICATE   (from console.agora.io)
// Optional: FIREBASE_PROJECT_ID (defaults to cleenzo-b6de5)
// ─────────────────────────────────────────────────────────────────────
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { RtcTokenBuilder, RtcRole } from 'agora-token'
import { createServiceClient } from '@/lib/supabase/admin'

const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID || 'cleenzo-b6de5'
const FIREBASE_KEYS = createRemoteJWKSet(new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'))

export const ACTIVE_STATUSES = ['accepted', 'otp_verified', 'in_progress']
export const OPENS_BEFORE_MINS = 30
export const UID = { customer: 1, worker: 2 } as const
export type Role = 'customer' | 'worker'

export const last10 = (p?: string | null) => (p ?? '').replace(/\D/g, '').slice(-10)
export const firstName = (n?: string | null) => (n ?? '').trim().split(/\s+/)[0] || ''

export function sb() { return createServiceClient() }

export type Caller = { phone: string | null; userId: string | null }

/** Who sent this request: their account id (Supabase login) and/or phone
 *  number (last 10 digits). null when the login token is missing/invalid. */
export async function caller(req: Request): Promise<Caller | null> {
  const h = req.headers.get('authorization') ?? ''
  const tok = h.startsWith('Bearer ') ? h.slice(7).trim() : ''
  if (!tok) return null
  // Supabase login first — the worker app's real account.
  try {
    const { data } = await sb().auth.getUser(tok)
    const u = data.user
    if (u) {
      let phone = last10(u.phone)
      if (phone.length !== 10) {
        const { data: row } = await sb().from('users').select('phone').eq('id', u.id).maybeSingle()
        phone = last10(row?.phone)
      }
      return { userId: u.id, phone: phone.length === 10 ? phone : null }
    }
  } catch { /* not a Supabase token */ }
  // Firebase phone login — the customer app.
  try {
    const { payload } = await jwtVerify(tok, FIREBASE_KEYS, {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT}`,
      audience: FIREBASE_PROJECT,
    })
    const p = last10(payload.phone_number as string | undefined)
    if (p.length === 10) return { userId: null, phone: p }
  } catch { /* invalid */ }
  return null
}

/** Is this caller the given user (by account id, or by phone number)? */
export function isPerson(c: Caller, user: { id: string; phone: string | null } | null | undefined): boolean {
  if (!user) return false
  if (c.userId && c.userId === user.id) return true
  return !!c.phone && last10(user.phone) === c.phone
}

/** Phone number (last 10 digits) of whoever sent this request, or null. */
export async function callerPhone(req: Request): Promise<string | null> {
  const h = req.headers.get('authorization') ?? ''
  const tok = h.startsWith('Bearer ') ? h.slice(7).trim() : ''
  if (!tok) return null
  try {
    const { payload } = await jwtVerify(tok, FIREBASE_KEYS, {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT}`,
      audience: FIREBASE_PROJECT,
    })
    const p = last10(payload.phone_number as string | undefined)
    if (p.length === 10) return p
  } catch { /* not a Firebase token — try Supabase below */ }
  try {
    // Supabase login (the worker app signs in to Supabase after the OTP).
    const { data } = await sb().auth.getUser(tok)
    const u = data.user
    if (u) {
      const p = last10(u.phone)
      if (p.length === 10) return p
      const { data: row } = await sb().from('users').select('phone').eq('id', u.id).maybeSingle()
      const p2 = last10(row?.phone)
      if (p2.length === 10) return p2
    }
  } catch { /* invalid */ }
  return null
}

export type BookingForCall = {
  id: string; status: string; scheduled_at: string | null
  customer_id: string; worker_id: string | null
  service_name: string
  customer: { id: string; full_name: string | null; phone: string | null } | null
  worker:   { id: string; full_name: string | null; phone: string | null } | null
}

export async function loadBooking(bookingId: string): Promise<BookingForCall | null> {
  const { data, error } = await sb().from('bookings')
    .select('id,status,scheduled_at,customer_id,worker_id,services(name)')
    .eq('id', bookingId).maybeSingle()
  if (error || !data) return null
  const ids = [data.customer_id, data.worker_id].filter(Boolean) as string[]
  const { data: people } = await sb().from('users').select('id,full_name,phone').in('id', ids)
  const find = (id: string | null) => (people ?? []).find((u: any) => u.id === id) ?? null
  const svc: any = (data as any).services
  return {
    id: data.id, status: data.status, scheduled_at: data.scheduled_at,
    customer_id: data.customer_id, worker_id: data.worker_id,
    service_name: (Array.isArray(svc) ? svc[0]?.name : svc?.name) ?? 'booking',
    customer: find(data.customer_id), worker: find(data.worker_id),
  }
}

/** Which side of this booking the phone belongs to ('as' breaks a tie when
 *  the same number is both, e.g. while testing). */
export function roleOf(b: BookingForCall, c: Caller, as?: string): Role | null {
  const isC = isPerson(c, b.customer)
  const isW = !!b.worker && isPerson(c, b.worker)
  if (isC && isW) return as === 'worker' ? 'worker' : 'customer'
  if (isC) return 'customer'
  if (isW) return 'worker'
  return null
}

/** null = calling allowed; otherwise a message the app can show. */
export function windowProblem(b: BookingForCall): { error: string; opens_at?: string } | null {
  if (!b.worker_id) return { error: 'A professional has not been assigned yet.' }
  if (b.status === 'completed') return { error: 'This booking is completed, so calling is closed.' }
  if (b.status === 'cancelled') return { error: 'This booking was cancelled.' }
  if (!ACTIVE_STATUSES.includes(b.status)) return { error: 'Calling is not available for this booking yet.' }
  if (b.scheduled_at) {
    const opens = new Date(new Date(b.scheduled_at).getTime() - OPENS_BEFORE_MINS * 60000)
    if (Date.now() < opens.getTime()) {
      const t = opens.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
      return { error: `Calling opens at ${t} (30 minutes before your booking).`, opens_at: opens.toISOString() }
    }
  }
  return null
}

/** A 2-hour Agora pass for one channel + one person. */
export function agoraPass(channel: string, uid: number) {
  // .trim(): a space or line break copied into Vercel by mistake makes
  // every call fail to connect, so it is removed here.
  const appId = process.env.AGORA_APP_ID?.trim()
  const cert = process.env.AGORA_APP_CERTIFICATE?.trim()
  if (!appId || !cert) throw new Error('Calling is not set up yet (AGORA_APP_ID / AGORA_APP_CERTIFICATE missing).')
  const ttl = 2 * 60 * 60
  const token = RtcTokenBuilder.buildTokenWithUid(appId, cert, channel, uid, RtcRole.PUBLISHER, ttl, ttl)
  return { app_id: appId, channel, token, uid }
}

/** Push through the existing /api/notifications/send route. All data values
 *  are strings (FCM requires that). Never throws. */
export async function push(origin: string, userId: string, title: string, body: string, data: Record<string, string>) {
  try {
    await fetch(`${origin}/api/notifications/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, title, body, data }),
    })
  } catch { /* the app also polls, so a failed push is not fatal */ }
}

/** For /api/calls/check — says whether the Agora keys look right, without
 *  revealing them. */
export function agoraKeyCheck() {
  const rawId = process.env.AGORA_APP_ID ?? ''
  const rawCert = process.env.AGORA_APP_CERTIFICATE ?? ''
  const id = rawId.trim(), cert = rawCert.trim()
  const hex32 = (v: string) => /^[0-9a-f]{32}$/i.test(v)
  return {
    app_id_present: id.length > 0,
    app_id_looks_right: hex32(id),
    app_id_starts_with: id.slice(0, 4),
    app_id_had_extra_spaces: rawId !== id,
    certificate_present: cert.length > 0,
    certificate_looks_right: hex32(cert),
    certificate_had_extra_spaces: rawCert !== cert,
    same_value_in_both: id.length > 0 && id === cert,
  }
}