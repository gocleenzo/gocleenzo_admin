import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'Worker id required' }, { status: 400 })

  const admin = createServiceClient()
  await admin.from('workers').delete().eq('user_id', id)
  await admin.from('users').delete().eq('id', id)

  return NextResponse.json({ success: true })
}
