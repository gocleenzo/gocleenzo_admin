// GET /api/calls/check — health check for in-app calling.
// • Anyone: whether the Agora keys in Vercel look right (keys never shown).
// • Logged in to the admin panel (same browser): also the database setup
//   and the last 3 calls with every step both phones reported.
import { NextRequest, NextResponse } from 'next/server'
import { agoraKeyCheck, agoraPass, sb } from '@/lib/calls/server'
import { verifyAdminSession } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
const VERSION = 'calls-2026-10-22-v7'

export async function GET(req: NextRequest) {
  const keys = agoraKeyCheck()
  let pass_ok = false
  let pass_error: string | null = null
  try { pass_ok = !!agoraPass('cz_check', 1).token } catch (e: any) { pass_error = e.message }
  const ok = keys.app_id_looks_right && keys.certificate_looks_right && !keys.same_value_in_both && pass_ok

  const out: Record<string, any> = {
    version: VERSION,
    ok,
    summary: ok
      ? 'Agora keys look correct.'
      : 'Agora keys are missing or wrong — check AGORA_APP_ID and AGORA_APP_CERTIFICATE in Vercel, then Redeploy.',
    ...keys,
    pass_ok,
    pass_error,
  }

  const token = req.cookies.get('admin_session')?.value
  const admin = token ? await verifyAdminSession(token).catch(() => null) : null
  if (!admin) {
    out.more = 'Log in to the admin panel in this browser, then reload to see the last calls.'
    return NextResponse.json(out)
  }

  const db = sb()
  const evCol = await db.from('booking_calls').select('events').limit(1)
  out.db_events_column = evCol.error ? `MISSING (${evCol.error.message})` : 'ok'
  const fn = await db.rpc('append_call_event', { p_call: '00000000-0000-0000-0000-000000000000', p_who: 'check', p_ev: 'check' })
  out.db_log_function = fn.error ? `MISSING (${fn.error.message})` : 'ok'

  const { data: calls, error } = await db.from('booking_calls')
    .select(evCol.error
      ? 'status,caller_role,created_at,answered_at,ended_at,duration_secs,ended_by'
      : 'status,caller_role,created_at,answered_at,ended_at,duration_secs,ended_by,events')
    .order('created_at', { ascending: false }).limit(3)
  const ist = (v: string | null) => v
    ? new Date(v).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })
    : null
  out.last_calls = error ? error.message : (calls ?? []).map((c: any) => ({
    started: ist(c.created_at),
    who_called: c.caller_role,
    status: c.status,
    answered: ist(c.answered_at),
    ended: ist(c.ended_at),
    ended_by: c.ended_by,
    seconds: c.duration_secs,
    steps: (c.events ?? []).map((e: any) => `${ist(e.t)?.split(', ')[1] ?? ''} ${e.who}: ${e.ev}`),
  }))
  return NextResponse.json(out)
}