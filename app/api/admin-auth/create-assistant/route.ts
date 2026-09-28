// app/api/admin-auth/create-assistant/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'
import { verifyAdminSession } from '@/lib/adminAuth'

function supabaseAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// POST — owner creates a new assistant: name + Gmail + password.
// Password is bcrypt-hashed here, server-side, before it ever touches
// the database — the plaintext never gets stored anywhere.
export async function POST(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  const session = token ? await verifyAdminSession(token) : null
  if (!session || session.role !== 'owner') {
    return NextResponse.json({ error: 'Only the owner can create assistant accounts' }, { status: 403 })
  }

  const { full_name, email, password } = await req.json()
  if (!full_name || !email || !password) {
    return NextResponse.json({ error: 'Name, email and password are all required' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  const supabase = supabaseAdmin()

  const { data: existing } = await supabase
    .from('admin_users')
    .select('id')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
  }

  const password_hash = await bcrypt.hash(password, 10)

  const { data, error } = await supabase
    .from('admin_users')
    .insert({
      full_name: full_name.trim(),
      email: email.trim().toLowerCase(),
      password_hash,
      role: 'assistant',
      is_active: true,
    })
    .select('id, full_name, email, role, is_active, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, assistant: data })
}

// GET — owner lists all assistants (name, email, active state — never the hash).
export async function GET(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  const session = token ? await verifyAdminSession(token) : null
  if (!session || session.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = supabaseAdmin()
  const { data, error } = await supabase
    .from('admin_users')
    .select('id, full_name, email, role, is_active, created_at')
    .eq('role', 'assistant')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ assistants: data ?? [] })
}