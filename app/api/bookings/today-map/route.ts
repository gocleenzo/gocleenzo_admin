import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'

// Always fresh, never cached — same convention as /api/workers/live.
export const dynamic = 'force-dynamic'
export const revalidate = 0

// NEW: feeds the "Today's Orders" layer on the Live Map. Returns every
// booking scheduled for a given calendar day (IST, matching how the
// rest of the admin panel reasons about "today"), with its address
// coordinates and everything an admin would want to see when clicking
// a pin — customer, service, time, assigned worker. Bookings without a
// geocoded address (no lat/lng) are skipped since there's nowhere to
// plot them.
//
// NEW: accepts an optional ?date=YYYY-MM-DD query param so the map can
// show any day, not just today — defaults to today (IST) when omitted.
export async function GET(req: NextRequest) {
  const supabase = createServiceClient()

  const dateParam = req.nextUrl.searchParams.get('date') // 'YYYY-MM-DD' or null

  let y: number, m: number, d: number
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const [yy, mm, dd] = dateParam.split('-').map(Number)
    y = yy; m = mm - 1; d = dd
  } else {
    const now = new Date()
    const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    y = istNow.getFullYear(); m = istNow.getMonth(); d = istNow.getDate()
  }

  // Compute the chosen day's [00:00, 24:00) window in IST, expressed as
  // UTC instants, since scheduled_at is stored as timestamptz. Using
  // Date.UTC with an out-of-range minute (-330 = -5h30m) lets JS
  // normalize the date rollback correctly across month/year boundaries.
  const startUTC = new Date(Date.UTC(y, m, d, -5, -30))
  const endUTC = new Date(startUTC.getTime() + 24 * 60 * 60 * 1000)

  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id, status, scheduled_at, final_amount, customer_name, customer_phone,
      assigned_worker_name, service_names, total_services,
      addresses(full_address, area, city, pincode, latitude, longitude),
      services(name)
    `)
    .gte('scheduled_at', startUTC.toISOString())
    .lt('scheduled_at', endUTC.toISOString())

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const orders = (data ?? [])
    .filter((b: any) => b.addresses?.latitude != null && b.addresses?.longitude != null)
    .map((b: any) => {
      const names: string[] = Array.isArray(b.service_names) ? b.service_names : []
      const serviceLabel = b.services?.name
        ?? (names.length > 0 ? names.join(' + ') : 'Service')
      return {
        id: b.id,
        status: b.status as string,
        scheduled_at: b.scheduled_at as string,
        final_amount: b.final_amount as number,
        customer_name: b.customer_name ?? 'Customer',
        customer_phone: b.customer_phone ?? '—',
        worker_name: b.assigned_worker_name ?? null,
        service: serviceLabel,
        total_services: b.total_services ?? 1,
        address: b.addresses?.full_address ?? '—',
        area: b.addresses?.area ?? '',
        city: b.addresses?.city ?? '',
        pincode: b.addresses?.pincode ?? '',
        lat: b.addresses.latitude as number,
        lng: b.addresses.longitude as number,
      }
    })

  return NextResponse.json({ orders })
}