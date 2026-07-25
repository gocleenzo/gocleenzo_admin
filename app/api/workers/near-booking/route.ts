import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: NextRequest) {
  const bookingId = req.nextUrl.searchParams.get('booking_id')
  if (!bookingId) {
    return NextResponse.json({ error: 'booking_id required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Customer location for this booking
  const { data: booking, error: bErr } = await supabase
    .from('bookings')
    .select('id, addresses(latitude, longitude, area, city)')
    .eq('id', bookingId)
    .maybeSingle()

  if (bErr) {
    return NextResponse.json({ error: bErr.message }, { status: 500 })
  }

  const addr: any = (booking as any)?.addresses
  const customer =
    addr && addr.latitude != null && addr.longitude != null
      ? {
          lat: addr.latitude as number,
          lng: addr.longitude as number,
          area: addr.area as string,
          city: addr.city as string,
        }
      : null

  // Ranked live workers
  const { data: workers, error: wErr } = await supabase.rpc(
    'live_workers_for_booking',
    { p_booking_id: bookingId }
  )

  if (wErr) {
    return NextResponse.json({ error: wErr.message }, { status: 500 })
  }

  return NextResponse.json({ customer, workers: workers ?? [] })
}