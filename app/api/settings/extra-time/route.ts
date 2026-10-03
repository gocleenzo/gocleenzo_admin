import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { verifyAdminSession } from '@/lib/adminAuth'

// Saves the Extra Time Offer (price + minutes) from the admin Services
// page. The browser can't write app_settings directly — the database
// rightly blocks that, since the browser connection uses the same
// public key as the customer/worker apps. This route runs on the
// server with full access, but ONLY after confirming the request
// comes from a logged-in admin (owner — assistants can't change
// prices). API routes aren't covered by middleware.ts's login check,
// so the check has to live here.

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  const session = token ? await verifyAdminSession(token) : null
  if (!session) {
    return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  }
  if (session.role === 'assistant') {
    return NextResponse.json({ error: 'Only the owner can change prices' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const price = Number(body?.price)
  const minutes = Number(body?.minutes)

  if (!Number.isInteger(price) || price < 1 || price > 10000) {
    return NextResponse.json({ error: 'Price must be a whole number from ₹1 to ₹10,000' }, { status: 400 })
  }
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 180) {
    return NextResponse.json({ error: 'Minutes must be a whole number from 5 to 180' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('app_settings')
    .update({ extra_time_price: price, extra_time_minutes: minutes })
    .eq('id', 'global')
    .select('extra_time_price, extra_time_minutes')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Settings row not found' }, { status: 500 })
  }

  return NextResponse.json(data)
}