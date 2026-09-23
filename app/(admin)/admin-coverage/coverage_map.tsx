'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { GoogleMap, useJsApiLoader } from '@react-google-maps/api'
import { GOOGLE_MAPS_LOADER_OPTIONS } from '@/lib/googleMapsLoader'
import { createClient } from '@/lib/supabase/client'

type Worker = {
  user_id: string
  name: string
  lat: number
  lng: number
  updatedAt: string | null
  verified: boolean
}

// The REAL "where we're currently live" data — the same service_areas
// table every booking eligibility check in this app already reads. No
// new data entry required, and this map can never show something
// different from what's really bookable.
type LiveArea = {
  pincode: string
  area: string
  parentArea: string | null
}

// A pincode's geocoded reference point + Google Place ID. The place ID
// is what actually lets us match this pincode against Google's real
// POSTAL_CODE boundary polygon (see the FeatureLayer section below) —
// the lat/lng/bounds are kept only as a fallback shape for when that
// polygon layer isn't available (Map ID not yet configured).
type GeocodedArea = {
  placeId: string | null
  lat: number
  lng: number
  bounds: { north: number; south: number; east: number; west: number } | null
}

const MUMBAI = { lat: 19.076, lng: 72.8777 }
const STALE_MS = 2 * 60 * 1000
const POLL_MS = 10000
// service_areas changes far less often than worker positions — polling
// this occasionally (rather than on every 10s worker tick) keeps this
// page's normal polling pattern consistent without hammering the
// database or the Geocoding API for data that's essentially static
// minute to minute.
const AREAS_POLL_MS = 60000
// Google's Geocoding API has a rate limit — spacing requests out
// avoids tripping it when there are many active pincodes to resolve,
// especially on first load before anything is cached.
const GEOCODE_DELAY_MS = 220
// Last-resort fallback shape only — used when NEITHER the real
// POSTAL_CODE FeatureLayer (no Map ID configured yet) NOR a geocoded
// viewport is available for a pincode. A rough single-digit-km urban
// postal-code footprint, not a precise boundary.
const FALLBACK_RADIUS_M = 1200

// Set this to the Map ID you create in Google Cloud Console (Maps
// Management -> Map IDs), with a Map Style attached that has the
// "Postal Code" data-driven-styling feature layer enabled. Until this
// is set, the map automatically falls back to drawing an approximate
// rectangle/circle per pincode instead of Google's real boundary
// polygon — see the fallback branch below. Recommended: move this to
// an env var (e.g. NEXT_PUBLIC_COVERAGE_MAP_ID) once you have a real
// value, rather than hardcoding it here.
const COVERAGE_MAP_ID = process.env.NEXT_PUBLIC_COVERAGE_MAP_ID || ''

const containerStyle = { width: '100%', height: '100%' }

export default function CoverageMap() {
  // Uses the shared loader config (same id/options as every other admin
  // page) — required by @react-google-maps/api's singleton loader, see
  // lib/googleMapsLoader.ts.
  const { isLoaded } = useJsApiLoader(GOOGLE_MAPS_LOADER_OPTIONS)
  const supabase = createClient()

  const [workers, setWorkers] = useState<Map<string, Worker>>(new Map())
  const [liveAreas, setLiveAreas] = useState<LiveArea[]>([])
  // Geocode results, keyed by pincode — resolved once and kept for the
  // life of the page; the periodic service_areas re-fetch only ever
  // geocodes pincodes that are genuinely new to this cache, never
  // re-resolves ones already known.
  const [geocoded, setGeocoded] = useState<Map<string, GeocodedArea>>(new Map())
  // NEW: captures WHY a pincode failed to geocode (Google's own status
  // string, e.g. 'REQUEST_DENIED', 'ZERO_RESULTS', 'OVER_QUERY_LIMIT')
  // — surfaced directly in the UI below instead of only console.error,
  // since "nothing is showing" with no visible reason is very hard to
  // debug from the outside. REQUEST_DENIED specifically almost always
  // means the Geocoding API itself isn't enabled on this Google Cloud
  // project — a very common gotcha, since enabling the Maps JavaScript
  // API does NOT automatically enable the separate Geocoding API.
  const [geocodeErrors, setGeocodeErrors] = useState<Map<string, string>>(new Map())
  const geocoderRef = useRef<google.maps.Geocoder | null>(null)
  const geocodingInFlight = useRef<Set<string>>(new Set())

  const [, setTick] = useState(0)
  const mapRef = useRef<google.maps.Map | null>(null)
  const infoRef = useRef<google.maps.InfoWindow | null>(null)
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map())
  // Fallback-mode overlays only (used when the real POSTAL_CODE
  // FeatureLayer isn't available) — one shaded Rectangle/Circle + one
  // name-label Marker per pincode, keyed by pincode.
  const areaShapesRef = useRef<Map<string, google.maps.Rectangle | google.maps.Circle>>(new Map())
  const areaLabelsRef = useRef<Map<string, google.maps.Marker>>(new Map())
  // Real POSTAL_CODE boundary layer — created once the map loads, IF a
  // Map ID is configured and the browser's map instance supports it.
  const postalCodeLayerRef = useRef<google.maps.FeatureLayer | null>(null)
  const [featureLayerSupported, setFeatureLayerSupported] = useState<boolean | null>(null)

  // Poll the secure server route (live-only: only workers with current_lat)
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const res = await fetch('/api/workers/live', { cache: 'no-store' })
        const json = await res.json()
        if (!active || !json.workers) return
        const map = new Map<string, Worker>()
        for (const w of json.workers as Worker[]) map.set(w.user_id, w)
        setWorkers(map)
      } catch {
        /* keep last known */
      }
    }
    load()
    const t = setInterval(load, POLL_MS)
    return () => {
      active = false
      clearInterval(t)
    }
  }, [])

  // Load the real, active service areas — the same table every booking
  // eligibility check in this app already reads.
  useEffect(() => {
    let active = true
    async function loadAreas() {
      const { data, error } = await supabase
        .from('service_areas')
        .select('pincode, area, parent_area')
        .eq('is_active', true)
        .order('area')
      if (!active) return
      if (error) {
        console.error('Load service areas error:', error)
        return
      }
      const seen = new Set<string>()
      const areas: LiveArea[] = []
      for (const row of (data ?? []) as any[]) {
        if (!row.pincode || seen.has(row.pincode)) continue
        seen.add(row.pincode)
        areas.push({ pincode: row.pincode, area: row.area, parentArea: row.parent_area })
      }
      setLiveAreas(areas)
    }
    loadAreas()
    const t = setInterval(loadAreas, AREAS_POLL_MS)
    return () => {
      active = false
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Geocode any pincode that isn't already resolved, using a STRICT
  // postal-code component search (not a blended free-text query) so
  // the returned place — and its place_id — genuinely represents the
  // postal code itself, which is what the real boundary layer below
  // needs to match against. Falls back to a looser combined query only
  // if the strict search finds nothing for a given pincode.
  useEffect(() => {
    if (!isLoaded) return
    if (!geocoderRef.current) geocoderRef.current = new google.maps.Geocoder()
    const geocoder = geocoderRef.current

    const toResolve = liveAreas.filter(
      (a) => !geocoded.has(a.pincode) && !geocodingInFlight.current.has(a.pincode)
    )
    if (toResolve.length === 0) return

    let cancelled = false

    async function resolveSequentially() {
      for (const a of toResolve) {
        if (cancelled) return
        geocodingInFlight.current.add(a.pincode)
        try {
          let strictStatus: string = 'UNKNOWN'
          const strict = await new Promise<google.maps.GeocoderResult[] | null>((resolve) => {
            geocoder.geocode(
              { componentRestrictions: { postalCode: a.pincode, country: 'IN' } },
              (results, status) => {
                strictStatus = status
                resolve(status === 'OK' && results ? results : null)
              }
            )
          })
          let result = strict?.find((r) => r.types.includes('postal_code')) ?? strict?.[0] ?? null

          let looseStatus: string | null = null
          if (!result) {
            const query = `${a.pincode}, ${a.parentArea || a.area}, Maharashtra, India`
            const loose = await new Promise<google.maps.GeocoderResult[] | null>((resolve) => {
              geocoder.geocode({ address: query }, (results, status) => {
                looseStatus = status
                resolve(status === 'OK' && results ? results : null)
              })
            })
            result = loose?.[0] ?? null
          }

          if (!cancelled && result) {
            const loc = result.geometry.location
            const viewport = result.geometry.viewport
            const resolved: GeocodedArea = {
              placeId: result.place_id ?? null,
              lat: loc.lat(),
              lng: loc.lng(),
              bounds: viewport
                ? {
                    north: viewport.getNorthEast().lat(),
                    east: viewport.getNorthEast().lng(),
                    south: viewport.getSouthWest().lat(),
                    west: viewport.getSouthWest().lng(),
                  }
                : null,
            }
            setGeocoded((prev) => {
              const next = new Map(prev)
              next.set(a.pincode, resolved)
              return next
            })
            // Clear any earlier recorded error for this pincode now
            // that it's resolved successfully.
            setGeocodeErrors((prev) => {
              if (!prev.has(a.pincode)) return prev
              const next = new Map(prev)
              next.delete(a.pincode)
              return next
            })
          } else if (!cancelled) {
            // NEW: both attempts failed — record WHY, visibly, instead
            // of silently leaving this pincode unresolved forever.
            // REQUEST_DENIED here almost always means the Geocoding API
            // itself isn't enabled for this project/key (a separate API
            // from the Maps JavaScript API that renders the base map).
            const reason = looseStatus ?? strictStatus
            console.error(`Geocode failed for pincode ${a.pincode}: strict=${strictStatus} loose=${looseStatus}`)
            setGeocodeErrors((prev) => {
              const next = new Map(prev)
              next.set(a.pincode, reason)
              return next
            })
          }
        } catch (e: any) {
          const reason = e?.message ?? 'JS_ERROR'
          console.error(`Geocode failed for pincode ${a.pincode}:`, e)
          setGeocodeErrors((prev) => {
            const next = new Map(prev)
            next.set(a.pincode, reason)
            return next
          })
        } finally {
          geocodingInFlight.current.delete(a.pincode)
        }
        // Space requests out to stay well clear of the Geocoding API's
        // rate limit, especially on first load with many pincodes.
        await new Promise((r) => setTimeout(r, GEOCODE_DELAY_MS))
      }
    }

    resolveSequentially()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveAreas, isLoaded])

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15000)
    return () => clearInterval(t)
  }, [])

  // Draw markers only — the 5km coverage-radius circle overlay has been
  // removed. This now shows exactly where each live, on-shift worker is,
  // without implying a fixed service radius around them (that concept is
  // now handled by admin-drawn service_zones + zone_workers assignments
  // instead of a uniform circle around every worker).
  useEffect(() => {
    if (!isLoaded || !mapRef.current) return
    const map = mapRef.current
    if (!infoRef.current) infoRef.current = new google.maps.InfoWindow()

    const now = Date.now()
    const seen = new Set<string>()

    workers.forEach((w) => {
      seen.add(w.user_id)
      const stale =
        !w.updatedAt || now - new Date(w.updatedAt).getTime() > STALE_MS
      // live-only: skip stale workers entirely (no marker when off-shift)
      if (stale) {
        markersRef.current.get(w.user_id)?.setMap(null)
        markersRef.current.delete(w.user_id)
        return
      }

      const pos = { lat: w.lat, lng: w.lng }

      // marker
      let marker = markersRef.current.get(w.user_id)
      const icon: google.maps.Symbol = {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 7,
        fillColor: '#0891B2',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
      }
      if (!marker) {
        marker = new google.maps.Marker({ position: pos, map, icon, title: w.name, zIndex: 10 })
        marker.addListener('click', () => {
          const cur = workers.get(w.user_id)
          if (!cur || !infoRef.current) return
          const ago = cur.updatedAt
            ? Math.round((Date.now() - new Date(cur.updatedAt).getTime()) / 1000)
            : null
          infoRef.current.setContent(
            `<div style="font-family:system-ui;font-size:13px;line-height:1.4">
               <strong>${cur.name}</strong>${cur.verified ? ' ✅' : ''}<br/>
               <span style="color:#6b7280">${ago == null ? '' : `Updated ${ago}s ago`}</span>
             </div>`
          )
          infoRef.current.open({ anchor: marker!, map })
        })
        markersRef.current.set(w.user_id, marker)
      } else {
        marker.setPosition(pos)
      }
    })

    // remove anything no longer present
    markersRef.current.forEach((m, id) => {
      if (!seen.has(id)) {
        m.setMap(null)
        markersRef.current.delete(id)
      }
    })
  }, [workers, isLoaded])

  // Set up the REAL POSTAL_CODE boundary layer once the map is ready.
  // Only works on a vector map created with a Map ID that has the
  // Postal Code data-driven-styling feature enabled in Cloud Console —
  // if that's not configured, getFeatureLayer throws/returns a layer
  // with isAvailable === false, and we fall back to drawing our own
  // approximate shapes instead (see the next effect).
  useEffect(() => {
    if (!isLoaded || !mapRef.current) return
    const map = mapRef.current
    try {
      const layer = map.getFeatureLayer(google.maps.FeatureType.POSTAL_CODE)
      if (layer && layer.isAvailable) {
        postalCodeLayerRef.current = layer
        setFeatureLayerSupported(true)
      } else {
        postalCodeLayerRef.current = null
        setFeatureLayerSupported(false)
      }
    } catch (e) {
      console.warn('POSTAL_CODE FeatureLayer not available (Map ID likely not configured) — falling back to approximate shapes:', e)
      postalCodeLayerRef.current = null
      setFeatureLayerSupported(false)
    }
  }, [isLoaded])

  // Real place IDs for every geocoded, active pincode — this is what
  // the boundary layer's style function matches against below.
  const activePlaceIds = useMemo(() => {
    const ids = new Set<string>()
    liveAreas.forEach((a) => {
      const g = geocoded.get(a.pincode)
      if (g?.placeId) ids.add(g.placeId)
    })
    return ids
  }, [liveAreas, geocoded])

  // Style the real boundary polygons — any postal code whose place_id
  // matches one of our active, resolved pincodes gets shaded; every
  // other postal code on the visible map stays unstyled (returning
  // null leaves Google's default, invisible-until-styled appearance).
  // Re-applied whenever the active place ID set changes so newly
  // resolved/added pincodes light up without needing a page reload.
  useEffect(() => {
    const layer = postalCodeLayerRef.current
    if (!layer || !featureLayerSupported) return

    layer.style = (params: google.maps.FeatureStyleFunctionOptions) => {
      const feature = params.feature as google.maps.PlaceFeature
      if (feature.placeId && activePlaceIds.has(feature.placeId)) {
        return {
          strokeColor: '#0891B2',
          strokeOpacity: 0.7,
          strokeWeight: 2,
          fillColor: '#0891B2',
          fillOpacity: 0.18,
        }
      }
      return null
    }
  }, [activePlaceIds, featureLayerSupported])

  // FALLBACK ONLY — draws an approximate rectangle/circle per pincode,
  // exactly as before, but ONLY when the real boundary layer above
  // isn't available (featureLayerSupported === false, i.e. no Map ID
  // configured yet). Once you set up the Map ID per the instructions
  // in COVERAGE_MAP_ID's comment, this whole fallback stops running
  // and the real polygons take over automatically.
  useEffect(() => {
    if (!isLoaded || !mapRef.current) return
    if (featureLayerSupported !== false) {
      // Real layer is active (or we don't know yet) — make sure no
      // leftover fallback shapes are still on the map from before a
      // Map ID was configured.
      areaShapesRef.current.forEach((s) => s.setMap(null))
      areaShapesRef.current.clear()
      areaLabelsRef.current.forEach((m) => m.setMap(null))
      areaLabelsRef.current.clear()
      return
    }

    const map = mapRef.current
    const seen = new Set<string>()

    liveAreas.forEach((a) => {
      const g = geocoded.get(a.pincode)
      if (!g) return
      seen.add(a.pincode)

      let shape = areaShapesRef.current.get(a.pincode)
      const shapeStyle = {
        strokeColor: '#0891B2',
        strokeOpacity: 0.55,
        strokeWeight: 1.5,
        fillColor: '#0891B2',
        fillOpacity: 0.10,
        clickable: false,
      }

      if (g.bounds) {
        const rectBounds = { north: g.bounds.north, south: g.bounds.south, east: g.bounds.east, west: g.bounds.west }
        if (!shape) {
          shape = new google.maps.Rectangle({ map, bounds: rectBounds, ...shapeStyle })
          areaShapesRef.current.set(a.pincode, shape)
        } else if (shape instanceof google.maps.Rectangle) {
          shape.setBounds(rectBounds)
        } else {
          shape.setMap(null)
          shape = new google.maps.Rectangle({ map, bounds: rectBounds, ...shapeStyle })
          areaShapesRef.current.set(a.pincode, shape)
        }
      } else {
        const center = { lat: g.lat, lng: g.lng }
        if (!shape) {
          shape = new google.maps.Circle({ map, center, radius: FALLBACK_RADIUS_M, ...shapeStyle })
          areaShapesRef.current.set(a.pincode, shape)
        } else if (shape instanceof google.maps.Circle) {
          shape.setCenter(center)
        }
      }

      let label = areaLabelsRef.current.get(a.pincode)
      const labelText = `${a.area} · ${a.pincode}`
      const labelPos = g.bounds
        ? { lat: (g.bounds.north + g.bounds.south) / 2, lng: (g.bounds.east + g.bounds.west) / 2 }
        : { lat: g.lat, lng: g.lng }
      const invisibleIcon: google.maps.Symbol = { path: google.maps.SymbolPath.CIRCLE, scale: 0 }
      if (!label) {
        label = new google.maps.Marker({
          position: labelPos, map, icon: invisibleIcon,
          label: { text: labelText, color: '#0E7490', fontSize: '11px', fontWeight: '800' },
          clickable: false,
        })
        areaLabelsRef.current.set(a.pincode, label)
      } else {
        label.setPosition(labelPos)
        label.setLabel({ text: labelText, color: '#0E7490', fontSize: '11px', fontWeight: '800' })
      }
    })

    areaShapesRef.current.forEach((s, pincode) => {
      if (!seen.has(pincode)) { s.setMap(null); areaShapesRef.current.delete(pincode) }
    })
    areaLabelsRef.current.forEach((m, pincode) => {
      if (!seen.has(pincode)) { m.setMap(null); areaLabelsRef.current.delete(pincode) }
    })
  }, [liveAreas, geocoded, isLoaded, featureLayerSupported])

  // Real-layer mode still needs its OWN name labels, since a styled
  // boundary polygon carries no visible text by itself — placed at
  // each pincode's geocoded reference point.
  useEffect(() => {
    if (!isLoaded || !mapRef.current || featureLayerSupported !== true) return
    const map = mapRef.current
    const seen = new Set<string>()
    const invisibleIcon: google.maps.Symbol = { path: google.maps.SymbolPath.CIRCLE, scale: 0 }

    liveAreas.forEach((a) => {
      const g = geocoded.get(a.pincode)
      if (!g) return
      seen.add(a.pincode)
      const labelText = `${a.area} · ${a.pincode}`
      let label = areaLabelsRef.current.get(a.pincode)
      if (!label) {
        label = new google.maps.Marker({
          position: { lat: g.lat, lng: g.lng }, map, icon: invisibleIcon,
          label: { text: labelText, color: '#0E7490', fontSize: '11px', fontWeight: '800' },
          clickable: false,
        })
        areaLabelsRef.current.set(a.pincode, label)
      } else {
        label.setPosition({ lat: g.lat, lng: g.lng })
        label.setLabel({ text: labelText, color: '#0E7490', fontSize: '11px', fontWeight: '800' })
      }
    })

    areaLabelsRef.current.forEach((m, pincode) => {
      if (!seen.has(pincode)) { m.setMap(null); areaLabelsRef.current.delete(pincode) }
    })
  }, [liveAreas, geocoded, isLoaded, featureLayerSupported])

  const activeCount = useMemo(() => {
    const now = Date.now()
    let n = 0
    workers.forEach((w) => {
      if (w.updatedAt && now - new Date(w.updatedAt).getTime() <= STALE_MS) n++
    })
    return n
  }, [workers])

  const resolvedAreaCount = useMemo(
    () => liveAreas.filter((a) => geocoded.has(a.pincode)).length,
    [liveAreas, geocoded]
  )

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 md:px-6 py-4 bg-white border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center text-lg"
            style={{ background: '#0891B214', border: '1px solid #0891B225' }}
          >
            📍
          </div>
          <div>
            <p className="font-black text-slate-900 text-lg leading-none tracking-tight">
              Live Worker Locations
            </p>
            <p className="text-[11px] text-slate-400 mt-1 font-semibold">
              on-shift workers · shaded areas show where you&apos;re currently live
              {featureLayerSupported === false && ' (approximate shape — set up a Map ID for exact boundaries)'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cyan-50 border border-cyan-100">
            <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
            <span className="text-xs font-black text-cyan-700">
              {activeCount} active
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200">
            <span className="w-2.5 h-2.5 rounded-full border-[1.5px]" style={{ borderColor: '#0891B2', background: 'rgba(8,145,178,0.10)' }} />
            <span className="text-xs font-black text-slate-600">
              {resolvedAreaCount}/{liveAreas.length} live area{liveAreas.length === 1 ? '' : 's'}
            </span>
          </span>
        </div>
      </div>

      {/* NEW: visible diagnostics — "nothing is showing" is otherwise
          impossible to debug from outside the browser console. Covers
          the two most likely causes: no active rows in service_areas
          at all, or the Geocoding API failing (REQUEST_DENIED almost
          always means the Geocoding API itself isn't enabled on this
          Google Cloud project — a separate API from the Maps
          JavaScript API that renders the base map, and easy to miss
          enabling). */}
      {liveAreas.length === 0 && (
        <div className="px-5 md:px-6 py-3 bg-amber-50 border-b border-amber-200">
          <p className="text-xs font-bold text-amber-800">
            ⚠️ No active rows found in <code>service_areas</code> — nothing to shade.
            Check that at least one row there has <code>is_active = true</code>.
          </p>
        </div>
      )}
      {geocodeErrors.size > 0 && (
        <div className="px-5 md:px-6 py-3 bg-red-50 border-b border-red-200">
          <p className="text-xs font-bold text-red-700 mb-1">
            ⚠️ {geocodeErrors.size} pincode{geocodeErrors.size === 1 ? '' : 's'} failed to geocode:
          </p>
          <p className="text-[11px] text-red-600 font-mono">
            {Array.from(geocodeErrors.entries()).map(([pc, reason]) => `${pc}: ${reason}`).join('  ·  ')}
          </p>
          {Array.from(geocodeErrors.values()).includes('REQUEST_DENIED') && (
            <p className="text-[11px] text-red-600 mt-1">
              REQUEST_DENIED usually means the <strong>Geocoding API</strong> isn&apos;t enabled for this
              Google Cloud project — it&apos;s separate from the Maps JavaScript API that renders the
              base map itself, so enabling one doesn&apos;t automatically enable the other. Check
              Google Cloud Console → APIs &amp; Services → Library → &quot;Geocoding API&quot; → Enable,
              and confirm your API key&apos;s restrictions (if any) allow it.
            </p>
          )}
        </div>
      )}

      <div className="flex-1 min-h-[480px] bg-slate-100">
        {isLoaded ? (
          <GoogleMap
            mapContainerStyle={containerStyle}
            center={MUMBAI}
            zoom={11}
            onLoad={(m) => {
              mapRef.current = m
            }}
            options={{
              streetViewControl: false,
              mapTypeControl: false,
              fullscreenControl: false,
              // mapId enables vector rendering, required for the real
              // POSTAL_CODE FeatureLayer. Falls back gracefully (see
              // featureLayerSupported above) if this is left empty or
              // the referenced Map ID has no Postal Code layer enabled.
              ...(COVERAGE_MAP_ID ? { mapId: COVERAGE_MAP_ID } : {}),
            }}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-slate-400 text-sm">
            Loading map…
          </div>
        )}
      </div>
    </div>
  )
}