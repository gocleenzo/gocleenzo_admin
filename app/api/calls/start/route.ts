// POST /api/calls/start   { booking_id, as?: 'customer' | 'worker' }
// Header: Authorization: Bearer <app login token>
//
// Starts a call for one booking: checks the caller belongs to it and the
// time window is open, logs the call, rings the other person (push), and
// returns the caller's private Agora pass.
import { NextRequest, NextResponse } from 'next/server'
import { caller, loadBooking, roleOf, windowProblem, agoraPass, push, sb, UID, firstName } from '@/lib/calls/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const me0 = await caller(req)
  if (!me0) return NextResponse.json({ error: 'Please log in again.' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const bookingId = String(body?.booking_id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return NextResponse.json({ error: 'Booking not found.' }, { status: 400 })

  const b = await loadBooking(bookingId)
  if (!b) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })

  const role = roleOf(b, me0, body?.as)
  if (!role) return NextResponse.json({ error: 'You are not part of this booking.' }, { status: 403 })

  const problem = windowProblem(b)
  if (problem) return NextResponse.json(problem, { status: 409 })

  const db = sb()
  await db.rpc('expire_stale_calls')
  // A new call replaces any call on this booking that is still ringing.
  await db.from('booking_calls')
    .update({ status: 'cancelled', ended_at: new Date().toISOString(), ended_by: 'system' })
    .eq('booking_id', b.id).eq('status', 'ringing')

  const callerId = role === 'customer' ? b.customer_id : b.worker_id!
  const calleeId = role === 'customer' ? b.worker_id! : b.customer_id
  const me   = role === 'customer' ? b.customer : b.worker
  const peer = role === 'customer' ? b.worker : b.customer
  const channel = `cz_${b.id.replace(/-/g, '').slice(0, 20)}_${Date.now().toString(36)}`

  const { data: call, error } = await db.from('booking_calls')
    .insert({ booking_id: b.id, caller_id: callerId, callee_id: calleeId, caller_role: role, channel })
    .select('id').single()
  if (error || !call) return NextResponse.json({ error: 'Could not start the call. Please try again.' }, { status: 500 })

  let pass
  try { pass = agoraPass(channel, UID[role]) }
  catch (e: any) {
    await db.from('booking_calls').update({ status: 'failed', ended_at: new Date().toISOString(), ended_by: 'system' }).eq('id', call.id)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }

  const myName = firstName(me?.full_name) || (role === 'customer' ? 'Your customer' : 'Your professional')
  await push(req.nextUrl.origin, calleeId,
    `📞 ${myName} is calling`,
    role === 'customer'
      ? `Your customer is calling about the ${b.service_name} job. Tap to answer.`
      : `Your Cleenzo professional is calling about your ${b.service_name}. Tap to answer.`,
    {
      type: 'cz_call', call_id: call.id, booking_id: b.id, caller_name: myName, caller_role: role,
      // The worker app rings full-screen from a silent (data-only) push.
      ...(role === 'customer' ? { ring: '1' } : {}),
    })

  return NextResponse.json({
    call_id: call.id,
    role,
    peer_name: firstName(peer?.full_name) || (role === 'customer' ? 'Professional' : 'Customer'),
    ...pass,
  })
}