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
  const { data: workersRaw, error: wErr } = await supabase.rpc(
    'live_workers_for_booking',
    { p_booking_id: bookingId }
  )

  if (wErr) {
    return NextResponse.json({ error: wErr.message }, { status: 500 })
  }

  let workers = workersRaw ?? []

  // ── Zone restriction — same rule the customer app's try_claim_slot and
  // admin-bookings' Drawer/quick-assign both already enforce, applied here
  // so the map (and its click-to-select pins) can't be used to bypass
  // zone assignment either. If the booking's address falls inside a zone
  // that has explicit worker assignments, only those workers are
  // returned; everyone else is filtered out of the map entirely rather
  // than just being blocked after the fact at save time. A zone with no
  // assignments configured (or an address with no coordinates) keeps
  // the previous behaviour — every live worker is shown, unrestricted.
  if (customer) {
    try {
      const { data: zoneId } = await supabase.rpc('find_zone_for_point', {
        p_lat: customer.lat,
        p_lng: customer.lng,
      })
      if (zoneId) {
        const { data: assignRows } = await supabase
          .from('zone_workers')
          .select('worker_id')
          .eq('zone_id', zoneId)
        const eligibleIds = new Set(
          (assignRows ?? []).map((r: any) => r.worker_id as string)
        )
        // Only filter if the zone actually has assignments — an empty
        // set means unrestricted, not "no one eligible".
        if (eligibleIds.size > 0) {
          workers = workers.filter((w: any) => eligibleIds.has(w.user_id))
        }
      }
    } catch (e) {
      // Fail open — a lookup hiccup here should never hide every worker
      // from the map, it should just fall back to unrestricted (the
      // pre-existing behaviour).
      console.warn('Zone filtering for near-booking map failed (non-fatal):', e)
    }
  }

  return NextResponse.json({ customer, workers })
}