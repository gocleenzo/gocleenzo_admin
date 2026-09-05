import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// ============================================================================
// GET/POST /api/admin/backfill-coordinates
// ============================================================================
// One-time (re-runnable, safe) batch job: finds every non-deleted address
// with a missing latitude/longitude and geocodes it using its saved
// full_address text via Google's Geocoding API, then updates the row.
//
// WHY THIS MATTERS: the exclusion-zone check in try_claim_slot() only
// runs `if v_lat is not null and v_lng is not null` — an address with no
// coordinates silently SKIPS the exclusion check entirely, meaning a
// customer could book from inside a drawn "excluded area" polygon if
// their saved address happens to have no lat/lng. This backfill closes
// that gap for existing addresses; new addresses saved via the app's own
// map/location flow already get coordinates at save time.
//
// Uses the same Google Maps API key as the admin panel's client-side map
// (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) — Geocoding API must be enabled for
// this key in Google Cloud Console (same requirement we already hit with
// the address map picker feature).
//
// Rate-limited with a small delay between calls (Google's default quota
// is generous, but 76 calls back-to-back with zero delay risks tripping
// short-burst limits) — safe to run once, safe to re-run (only ever
// touches rows still missing coordinates, never overwrites an address
// that already has them).
// ============================================================================

function supabaseAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

async function geocodeAddress(
  addressText: string,
  apiKey: string
): Promise<{ lat: number; lng: number } | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    addressText
  )}&region=in&key=${apiKey}`

  const res = await fetch(url)
  const data = await res.json()

  if (data.status !== 'OK' || !data.results?.[0]?.geometry?.location) {
    return null
  }

  const loc = data.results[0].geometry.location
  return { lat: loc.lat, lng: loc.lng }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set' },
      { status: 500 }
    )
  }

  const supabase = supabaseAdmin()

  const { data: addresses, error: fetchError } = await supabase
    .from('addresses')
    .select('id, flat_no, building, area, city, pincode, full_address')
    .eq('is_deleted', false)
    .or('latitude.is.null,longitude.is.null')

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!addresses || addresses.length === 0) {
    return NextResponse.json({
      message: 'No addresses missing coordinates — nothing to do.',
      processed: 0,
      succeeded: 0,
      failed: 0,
    })
  }

  const results: { id: string; status: 'ok' | 'failed'; reason?: string }[] = []

  for (const addr of addresses) {
    // Prefer the saved full_address text (most complete/accurate as
    // typed by the customer); fall back to building it from parts for
    // older rows that never had full_address populated.
    const addressText =
      (addr.full_address as string | null)?.trim() ||
      [addr.flat_no, addr.building, addr.area, addr.city, addr.pincode]
        .filter(Boolean)
        .join(', ')

    if (!addressText) {
      results.push({ id: addr.id, status: 'failed', reason: 'No address text to geocode' })
      continue
    }

    try {
      const coords = await geocodeAddress(addressText, apiKey)
      if (!coords) {
        results.push({ id: addr.id, status: 'failed', reason: 'Geocoding returned no result' })
        continue
      }

      const { error: updateError } = await supabase
        .from('addresses')
        .update({ latitude: coords.lat, longitude: coords.lng })
        .eq('id', addr.id)

      if (updateError) {
        results.push({ id: addr.id, status: 'failed', reason: updateError.message })
      } else {
        results.push({ id: addr.id, status: 'ok' })
      }
    } catch (e: any) {
      results.push({ id: addr.id, status: 'failed', reason: e?.message ?? 'Unknown error' })
    }

    // Small delay between requests — polite to Google's API, avoids
    // tripping short-burst rate limits on a batch this size.
    await delay(150)
  }

  const succeeded = results.filter((r) => r.status === 'ok').length
  const failed = results.filter((r) => r.status === 'failed').length

  return NextResponse.json({
    message: `Processed ${results.length} address(es).`,
    processed: results.length,
    succeeded,
    failed,
    failures: results.filter((r) => r.status === 'failed'),
  })
}

// Allow triggering via a simple browser GET too (e.g. visiting the URL
// directly), since this is a one-time admin tool, not a public endpoint.
export async function GET(req: NextRequest) {
  return POST(req)
}