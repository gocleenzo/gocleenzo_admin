// app/api/admin-auth/toggle-assistant/route.ts
// POST { id, is_active } — owner blocks / unblocks an assistant's login.
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
  if (!session) return NextResponse.json({ error: 'Please log in again.' }, { status: 401 })
  if (session.role !== 'owner') {
    return NextResponse.json({ error: 'Only the owner can block or unblock assistants.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const id = String(body?.id ?? body?.assistant_id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Assistant not found.' }, { status: 400 })
  }
  if (id === session.id) {
    return NextResponse.json({ error: 'You cannot block your own login.' }, { status: 400 })
  }

  const supabase = supabaseAdmin()
  const { data: who, error: findErr } = await supabase
    .from('admin_users').select('id, role, is_active').eq('id', id).maybeSingle()
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 })
  if (!who || who.role !== 'assistant') {
    return NextResponse.json({ error: 'Assistant not found.' }, { status: 404 })
  }

  // If the page doesn't say which way, just flip it.
  const next = typeof body?.is_active === 'boolean' ? body.is_active : !who.is_active

  const { data, error } = await supabase
    .from('admin_users')
    .update({ is_active: next })
    .eq('id', id)
    .select('id, full_name, email, role, is_active, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, assistant: data })
}