// app/api/admin-auth/assign-worker/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { requestScope, bookingAllowed, workerAllowed, OUTSIDE_AREA } from '@/lib/staffScope'

function supabaseAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function POST(req: NextRequest) {
  const scope = await requestScope(req)
  if (!scope) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = scope.session

  const { booking_id, worker_id } = await req.json()
  if (!booking_id || !worker_id) {
    return NextResponse.json({ error: 'booking_id and worker_id are required' }, { status: 400 })
  }

  // Assistants: only bookings in their areas, only workers who cover them.
  if (!(await bookingAllowed(scope, booking_id)) || !workerAllowed(scope, worker_id)) {
    return NextResponse.json({ error: OUTSIDE_AREA }, { status: 403 })
  }

  const supabase = supabaseAdmin()
  const { data, error } = await supabase.rpc('admin_assign_worker_logged', {
    p_booking_id: booking_id,
    p_worker_id: worker_id,
    p_performed_by: session.id,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, data })
}