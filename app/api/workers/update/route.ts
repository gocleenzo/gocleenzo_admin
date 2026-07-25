import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { id, full_name, phone, email, is_available, is_verified, is_active, worker_otp } = await req.json()

  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })

  const { error: userErr } = await supabase.from('users').update({
    full_name, phone, email: email || null, is_active,
  }).eq('id', id)

  if (userErr) return NextResponse.json({ error: userErr.message }, { status: 400 })

  await supabase.from('workers').upsert({
    user_id: id,
    is_available, is_verified,
    worker_otp: worker_otp || null,
  }, { onConflict: 'user_id' })

  return NextResponse.json({ success: true })
}