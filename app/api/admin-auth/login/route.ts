import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'
import { signAdminSession } from '../../../../lib/adminAuth'

function supabaseAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  }

  const supabase = supabaseAdmin()
  const { data: user, error } = await supabase
    .from('admin_users')
    .select('id, email, password_hash, role, full_name, is_active')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle()

  if (error || !user || !user.is_active) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  // NOTE: signAdminSession is now async (switched to the 'jose' library,
  // which works in both Node and the Edge runtime middleware uses —
  // 'jsonwebtoken' does not work in Edge, which was the root cause of
  // the login-redirect-loop bug).
  const token = await signAdminSession({
    id: user.id,
    email: user.email,
    role: user.role,
    full_name: user.full_name,
  })

  const res = NextResponse.json({ success: true, role: user.role })
  res.cookies.set('admin_session', token, {
    httpOnly: true,
    // Secure cookies are silently rejected by browsers on plain http://
    // (e.g. localhost in dev) — only require it in production, where
    // the site is always served over https anyway.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    // No maxAge set -> browser session cookie, cleared when browser closes.
  })
  return res
}