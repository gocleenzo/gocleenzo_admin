import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { verifyAdminSession } from '../../../../lib/adminAuth'

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
  if (!session || session.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { assistant_id, is_active } = await req.json()
  if (!assistant_id || typeof is_active !== 'boolean') {
    return NextResponse.json({ error: 'assistant_id and is_active required' }, { status: 400 })
  }

  const supabase = supabaseAdmin()
  const { error } = await supabase
    .from('admin_users')
    .update({ is_active })
    .eq('id', assistant_id)
    .eq('role', 'assistant') // safety: can never touch an owner row via this route

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}