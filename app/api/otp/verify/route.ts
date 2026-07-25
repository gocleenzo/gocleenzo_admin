import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const { phone, otp } = await req.json()
  if (!phone || !otp) return NextResponse.json({ error: 'Phone and OTP required' }, { status: 400 })

  // Format phone to E.164
  const cleaned = phone.replace(/\D/g, '')
  const e164 = cleaned.startsWith('91') && cleaned.length === 12
    ? `+${cleaned}`
    : `+91${cleaned}`

  const admin = createServiceClient()

  // Verify the OTP token via Supabase
  const { data: verifyData, error: verifyError } = await admin.auth.verifyOtp({
    phone: e164,
    token: otp,
    type: 'sms',
  })

  if (verifyError || !verifyData?.user) {
    console.error('OTP verify error:', verifyError)
    return NextResponse.json({ error: 'Invalid OTP' }, { status: 401 })
  }

  const authUser = verifyData.user

  // Upsert user record in your users table
  const { data: existingUser } = await admin
    .from('users')
    .select('id, phone, role, full_name')
    .eq('id', authUser.id)
    .maybeSingle()

  if (!existingUser) {
    await admin.from('users').insert({
      id:          authUser.id,
      phone:       cleaned.slice(-10), // store as 10-digit
      is_verified: true,
      role:        'customer',
    })
  }

  const userRecord = existingUser ?? { id: authUser.id, phone: cleaned.slice(-10), role: 'customer', full_name: '' }

  return NextResponse.json({
    success:       true,
    user:          userRecord,
    access_token:  verifyData.session?.access_token ?? '',
    refresh_token: verifyData.session?.refresh_token ?? '',
  })
}
