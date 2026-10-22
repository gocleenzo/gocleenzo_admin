// GET /api/calls/check — quick health check for in-app calling.
// Open it in a browser: it says whether the Agora keys in Vercel look
// right (never shows the keys themselves) and whether a call pass can be
// made with them.
import { NextResponse } from 'next/server'
import { agoraKeyCheck, agoraPass } from '@/lib/calls/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const keys = agoraKeyCheck()
  let pass_ok = false
  let pass_error: string | null = null
  try { pass_ok = !!agoraPass('cz_check', 1).token } catch (e: any) { pass_error = e.message }
  const ok = keys.app_id_looks_right && keys.certificate_looks_right && !keys.same_value_in_both && pass_ok
  return NextResponse.json({
    ok,
    summary: ok
      ? 'Agora keys look correct. Compare app_id_starts_with with the App ID of the Cleenzo project in Agora.'
      : 'Agora keys are missing or wrong — check AGORA_APP_ID and AGORA_APP_CERTIFICATE in Vercel, then Redeploy.',
    ...keys,
    pass_ok,
    pass_error,
  })
}