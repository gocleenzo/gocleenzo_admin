import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { full_name, phone, email, is_available, worker_otp } = await req.json()

  if (!full_name || !phone) {
    return NextResponse.json({ error: 'Name and phone required' }, { status: 400 })
  }

  const { data: user, error: userErr } = await supabase.from('users').insert({
    full_name, phone, email: email || null,
    role: 'worker', is_active: true,
  }).select().single()

  if (userErr) return NextResponse.json({ error: userErr.message }, { status: 400 })

  await supabase.from('workers').upsert({
    user_id: user.id,
    is_available: is_available ?? true,
    is_verified: false,
    worker_otp: worker_otp || null,
  }, { onConflict: 'user_id' })

  return NextResponse.json({ id: user.id })
}