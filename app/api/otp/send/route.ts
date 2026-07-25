import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const { phone } = await req.json()
  if (!phone) return NextResponse.json({ error: 'Phone required' }, { status: 400 })

  // Format phone to E.164 for Supabase
  const cleaned = phone.replace(/\D/g, '')
  const e164 = cleaned.startsWith('91') && cleaned.length === 12
    ? `+${cleaned}`
    : `+91${cleaned}`

  const admin = createServiceClient()
  const { error } = await admin.auth.signInWithOtp({ phone: e164 })

  if (error) {
    console.error('Supabase OTP error:', error)
    return NextResponse.json({ error: 'Failed to send OTP' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
