// POST /api/calls/update   { call_id, action, as? }
// Header: Authorization: Bearer <app login token>
//
// action:
//   status  – either side: current status (the caller checks this while ringing)
//   answer  – the person being called picks up → returns their Agora pass
//   decline – the person being called rejects
//   cancel  – the caller hangs up before it was answered
//   missed  – the caller gave up after ringing for a while
//   end     – either side hangs up an answered call
import { NextRequest, NextResponse } from 'next/server'
import { caller as whoIs, isPerson, agoraPass, push, sb, UID, firstName, Role } from '@/lib/calls/server'

export const dynamic = 'force-dynamic'

const ACTIONS = ['status', 'answer', 'decline', 'cancel', 'missed', 'end', 'log'] as const

export async function POST(req: NextRequest) {
  const me = await whoIs(req)
  if (!me) return NextResponse.json({ error: 'Please log in again.' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const callId = String(body?.call_id ?? '')
  const action = String(body?.action ?? '') as typeof ACTIONS[number]
  if (!/^[0-9a-f-]{36}$/i.test(callId) || !ACTIONS.includes(action)) {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }

  const db = sb()
  await db.rpc('expire_stale_calls')
  const { data: call } = await db.from('booking_calls')
    .select('id,booking_id,caller_id,callee_id,caller_role,channel,status,answered_at')
    .eq('id', callId).maybeSingle()
  if (!call) return NextResponse.json({ error: 'Call not found.' }, { status: 404 })

  const { data: people } = await db.from('users').select('id,full_name,phone').in('id', [call.caller_id, call.callee_id])
  const caller = (people ?? []).find((u: any) => u.id === call.caller_id)
  const callee = (people ?? []).find((u: any) => u.id === call.callee_id)
  const isCaller = isPerson(me, caller as any)
  const isCallee = isPerson(me, callee as any)
  if (!isCaller && !isCallee) return NextResponse.json({ error: 'Not your call.' }, { status: 403 })

  const callerRole = call.caller_role as Role
  const calleeRole: Role = callerRole === 'customer' ? 'worker' : 'customer'
  // Same phone on both sides only happens while testing — 'as' decides.
  const actingAsCallee = isCallee && (!isCaller || body?.as === calleeRole)
  const now = new Date().toISOString()

  if (action === 'status') return NextResponse.json({ status: call.status })

  // Step-by-step log from each phone (joined, connected, errors…), kept on
  // the call row so connection problems can be read back in Supabase.
  if (action === 'log') {
    const who = actingAsCallee ? calleeRole : callerRole
    const ev = String(body?.event ?? '').slice(0, 300)
    if (ev) await db.rpc('append_call_event', { p_call: call.id, p_who: who, p_ev: ev })
    return NextResponse.json({ ok: true })
  }

  if (action === 'answer') {
    if (!actingAsCallee) return NextResponse.json({ error: 'Not your call.' }, { status: 403 })
    if (call.status !== 'ringing' && call.status !== 'answered') {
      return NextResponse.json({ error: 'This call has already ended.', status: call.status }, { status: 409 })
    }
    if (call.status === 'ringing') {
      await db.from('booking_calls').update({ status: 'answered', answered_at: now }).eq('id', call.id).eq('status', 'ringing')
    }
    try {
      return NextResponse.json({
        status: 'answered',
        peer_name: firstName(caller?.full_name) || (callerRole === 'customer' ? 'Customer' : 'Professional'),
        ...agoraPass(call.channel, UID[calleeRole]),
      })
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 })
    }
  }

  if (action === 'decline' || action === 'cancel' || action === 'missed') {
    if (call.status !== 'ringing') return NextResponse.json({ status: call.status })
    const newStatus = action === 'decline' ? 'declined' : action === 'cancel' ? 'cancelled' : 'missed'
    const by: Role = actingAsCallee ? calleeRole : callerRole
    await db.from('booking_calls').update({ status: newStatus, ended_at: now, ended_by: by }).eq('id', call.id).eq('status', 'ringing')
    if (newStatus !== 'declined') {
      // Stops the ringing on the other phone and leaves a missed-call note.
      const name = firstName(caller?.full_name) || (callerRole === 'customer' ? 'Your customer' : 'Your professional')
      await push(req.nextUrl.origin, call.callee_id, `Missed call from ${name}`,
        'Open the booking in Cleenzo to call back.',
        { type: 'cz_call_end', call_id: call.id, booking_id: call.booking_id })
    }
    return NextResponse.json({ status: newStatus })
  }

  // action === 'end'
  if (call.status === 'answered') {
    const secs = call.answered_at ? Math.max(0, Math.round((Date.now() - new Date(call.answered_at).getTime()) / 1000)) : 0
    const by: Role = actingAsCallee ? calleeRole : callerRole
    await db.from('booking_calls').update({ status: 'ended', ended_at: now, duration_secs: secs, ended_by: by }).eq('id', call.id).eq('status', 'answered')
    return NextResponse.json({ status: 'ended', duration_secs: secs })
  }
  if (call.status === 'ringing') {
    await db.from('booking_calls').update({ status: 'cancelled', ended_at: now, ended_by: actingAsCallee ? calleeRole : callerRole }).eq('id', call.id).eq('status', 'ringing')
    return NextResponse.json({ status: 'cancelled' })
  }
  return NextResponse.json({ status: call.status })
}