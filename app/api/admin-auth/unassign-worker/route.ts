// app/api/admin-auth/unassign-worker/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { verifyAdminSession } from '@/lib/adminAuth'

function supabaseAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  const session = token ? await verifyAdminSession(token) : null
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { booking_id } = await req.json()
  if (!booking_id) {
    return NextResponse.json({ error: 'booking_id is required' }, { status: 400 })
  }

  const supabase = supabaseAdmin()
  const { data, error } = await supabase.rpc('admin_unassign_worker', {
    p_booking_id: booking_id,
    p_performed_by: session.id,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, data })
}