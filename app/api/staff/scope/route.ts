// GET /api/staff/scope — what the logged-in admin user may see.
// The admin pages use this to show only the assistant's areas; every
// change they make is checked again on the server (/api/staff/action).
import { NextRequest, NextResponse } from 'next/server'
import { requestScope } from '@/lib/staffScope'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const scope = await requestScope(req)
    if (!scope) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
    return NextResponse.json({
      role: scope.session.role,
      all: scope.all,
      areas: scope.areas,
      pincodes: Array.from(scope.pincodes),
      worker_ids: Array.from(scope.workerIds),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Could not load your areas' }, { status: 500 })
  }
}