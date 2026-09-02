'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { GoogleMap, useJsApiLoader } from '@react-google-maps/api'
import { isWithinShift, type WeekSchedule } from '@/lib/shift'
import { GOOGLE_MAPS_LOADER_OPTIONS } from '@/lib/googleMapsLoader'

type LiveWorker = {
  user_id: string
  full_name: string
  phone: string
  current_lat: number
  current_lng: number
  location_updated_at: string | null
  distance_km: number
  is_verified: boolean
  is_available: boolean
  is_busy: boolean
  schedule: WeekSchedule | null
  // NEW — a genuine time-overlap check against THIS booking's own
  // scheduled window (see live_workers_for_booking() SQL), separate
  // from is_busy (which only ever meant "in_progress right now").
  // Warn-only: never filters a worker out of the list or blocks
  // selection — admin can still choose a conflicted worker if they
  // know something the system doesn't.
  has_time_conflict: boolean
  conflict_detail: string | null
}
type Customer = { lat: number; lng: number; area: string; city: string }

function workerStatus(w: LiveWorker): { key: string; color: string; label: string; emoji: string } {
  if (w.is_busy) return { key: 'busy', color: '#F59E0B', label: 'Busy', emoji: '🟡' }
  const inShift = isWithinShift(w.schedule)
  if (inShift && w.is_available) return { key: 'ready', color: '#10B981', label: 'Available', emoji: '🟢' }
  return { key: 'offshift', color: '#94A3B8', label: 'Off shift', emoji: '⚫' }
}

const SELECTED_COLOR = '#2563EB'
const CUSTOMER_COLOR = '#DC2626'
const CONFLICT_COLOR = '#DC2626'

// Attractive Google Maps style
const MAP_STYLES: google.maps.MapTypeStyle[] = [
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#f5f5f5' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dbeafe' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f8fafc' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e0f2fe' }] },
]

function agoStr(ts: string | null) {
  if (!ts) return null
  const sec = Math.round((Date.now() - new Date(ts).getTime()) / 1000)
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`
  return `${Math.round(sec / 3600)}h ago`
}

export default function AssignMap({
  bookingId,
  selectedWorkerId,
  onSelectWorker,
}: {
  bookingId: string
  selectedWorkerId?: string
  onSelectWorker?: (id: string) => void
}) {
  const { isLoaded } = useJsApiLoader(GOOGLE_MAPS_LOADER_OPTIONS)

  const [customer, setCustomer]   = useState<Customer | null>(null)
  const [workers, setWorkers]     = useState<LiveWorker[]>([])
  const [loading, setLoading]     = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [mapType, setMapType]     = useState<'roadmap' | 'satellite'>('roadmap')
  const [zoom, setZoom]           = useState(13)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  const mapRef             = useRef<google.maps.Map | null>(null)
  const custMarkerRef      = useRef<google.maps.Marker | null>(null)
  const custInfoRef        = useRef<google.maps.InfoWindow | null>(null)
  const workerMarkersRef   = useRef<Map<string, google.maps.Marker>>(new Map())
  const workerInfosRef     = useRef<Map<string, google.maps.InfoWindow>>(new Map())
  const openInfoRef        = useRef<google.maps.InfoWindow | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workers/near-booking?booking_id=${bookingId}`, { cache: 'no-store' })
      const json = await res.json()
      setCustomer(json.customer ?? null)
      setWorkers((json.workers ?? []) as LiveWorker[])
      setLastUpdate(new Date())
    } catch { /* keep last */ }
    finally { setLoading(false) }
  }, [bookingId])

  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [load])

  // Build/update markers whenever map data changes
  useEffect(() => {
    if (!isLoaded || !mapRef.current) return
    const map = mapRef.current

    // ── Customer marker ──────────────────────────────────────────
    if (customer) {
      const pos = { lat: customer.lat, lng: customer.lng }
      if (!custMarkerRef.current) {
        custMarkerRef.current = new google.maps.Marker({
          position: pos, map,
          icon: {
            url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
              <svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
                <filter id="shadow">
                  <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.3"/>
                </filter>
                <ellipse cx="18" cy="40" rx="8" ry="3" fill="rgba(0,0,0,0.15)"/>
                <path d="M18 0 C8 0 0 8 0 18 C0 30 18 44 18 44 C18 44 36 30 36 18 C36 8 28 0 18 0Z"
                  fill="${CUSTOMER_COLOR}" filter="url(#shadow)"/>
                <circle cx="18" cy="17" r="8" fill="white"/>
                <text x="18" y="21" text-anchor="middle" font-size="10" fill="${CUSTOMER_COLOR}">🏠</text>
              </svg>
            `)}`,
            anchor: new google.maps.Point(18, 44),
            scaledSize: new google.maps.Size(36, 44),
          },
          title: `Customer — ${customer.area}`,
          zIndex: 999,
          animation: google.maps.Animation.DROP,
        })
        custInfoRef.current = new google.maps.InfoWindow({
          content: `
            <div style="font-family:system-ui;padding:8px 4px;min-width:160px">
              <div style="font-weight:900;font-size:13px;color:#0F172A;margin-bottom:4px">📍 Customer Location</div>
              <div style="font-size:11px;color:#64748B">${customer.area}${customer.city ? `, ${customer.city}` : ''}</div>
              <div style="margin-top:6px;padding:4px 8px;background:#FEE2E2;border-radius:6px;font-size:10px;font-weight:700;color:#DC2626">Service location</div>
            </div>
          `,
        })
        custMarkerRef.current.addListener('click', () => {
          openInfoRef.current?.close()
          custInfoRef.current?.open(map, custMarkerRef.current!)
          openInfoRef.current = custInfoRef.current
        })
      } else {
        custMarkerRef.current.setPosition(pos)
      }
    }

    // ── Worker markers ────────────────────────────────────────────
    const seen = new Set<string>()
    workers.forEach((w, i) => {
      seen.add(w.user_id)
      const selected = w.user_id === selectedWorkerId
      const st = workerStatus(w)
      const color = selected ? SELECTED_COLOR : st.color
      const scale = selected ? 40 : 32

      const svgIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${scale}" height="${scale + 8}" viewBox="0 0 40 48">
          <filter id="s"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.25"/></filter>
          <ellipse cx="20" cy="44" rx="9" ry="3.5" fill="rgba(0,0,0,0.12)"/>
          <path d="M20 0 C9 0 0 9 0 20 C0 33 20 48 20 48 C20 48 40 33 40 20 C40 9 31 0 20 0Z"
            fill="${color}" filter="url(#s)"/>
          <circle cx="20" cy="19" r="11" fill="white" opacity="0.95"/>
          <text x="20" y="24" text-anchor="middle" font-size="13" font-weight="900" fill="${color}">${i + 1}</text>
          ${selected ? `<circle cx="33" cy="7" r="7" fill="#22C55E"/><text x="33" y="11" text-anchor="middle" font-size="9" fill="white">✓</text>` : ''}
          ${w.has_time_conflict ? `<circle cx="7" cy="7" r="7" fill="${CONFLICT_COLOR}"/><text x="7" y="11" text-anchor="middle" font-size="10" fill="white" font-weight="900">!</text>` : ''}
        </svg>
      `

      const icon = {
        url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svgIcon)}`,
        anchor: new google.maps.Point(scale / 2, scale + 8),
        scaledSize: new google.maps.Size(scale, scale + 8),
      }

      const ago = agoStr(w.location_updated_at)
      const infoContent = `
        <div style="font-family:system-ui;padding:8px 4px;min-width:180px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <div style="width:28px;height:28px;border-radius:8px;background:${color};display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;color:white">${i + 1}</div>
            <div>
              <div style="font-weight:900;font-size:13px;color:#0F172A">${w.full_name}</div>
              <div style="font-size:11px;color:#64748B">${w.phone}</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <span style="padding:3px 8px;border-radius:20px;font-size:10px;font-weight:700;background:${st.color}20;color:${st.color}">${st.emoji} ${st.label}</span>
            <span style="padding:3px 8px;border-radius:20px;font-size:10px;font-weight:700;background:#F0FDFF;color:#0891B2">📍 ${w.distance_km.toFixed(1)} km away</span>
          </div>
          ${ago ? `<div style="margin-top:4px;font-size:10px;color:#94A3B8">Updated ${ago}</div>` : ''}
          ${w.is_verified ? `<div style="margin-top:4px;font-size:10px;color:#059669;font-weight:700">✓ Verified worker</div>` : ''}
          ${w.has_time_conflict ? `<div style="margin-top:6px;padding:4px 8px;background:#FEE2E2;border-radius:6px;font-size:10px;font-weight:700;color:#DC2626">⚠️ ${w.conflict_detail ?? 'Already booked for another job at this time'}</div>` : ''}
        </div>
      `

      let m = workerMarkersRef.current.get(w.user_id)
      if (!m) {
        m = new google.maps.Marker({
          position: { lat: w.current_lat, lng: w.current_lng },
          map, icon,
          title: `${w.full_name} — ${st.label} — ${w.distance_km.toFixed(1)} km${w.has_time_conflict ? ' — ⚠️ time conflict' : ''}`,
          zIndex: selected ? 100 : 10,
          animation: google.maps.Animation.DROP,
        })
        const infoWindow = new google.maps.InfoWindow({ content: infoContent })
        workerInfosRef.current.set(w.user_id, infoWindow)
        m.addListener('click', () => {
          openInfoRef.current?.close()
          infoWindow.open(map, m!)
          openInfoRef.current = infoWindow
          onSelectWorker?.(w.user_id)
        })
        workerMarkersRef.current.set(w.user_id, m)
      } else {
        m.setPosition({ lat: w.current_lat, lng: w.current_lng })
        m.setIcon(icon)
        m.setZIndex(selected ? 100 : 10)
        workerInfosRef.current.get(w.user_id)?.setContent(infoContent)
      }
    })

    workerMarkersRef.current.forEach((m, id) => {
      if (!seen.has(id)) {
        m.setMap(null)
        workerMarkersRef.current.delete(id)
        workerInfosRef.current.delete(id)
      }
    })

    // Auto-fit bounds
    if (customer || workers.length) {
      const bounds = new google.maps.LatLngBounds()
      if (customer) bounds.extend({ lat: customer.lat, lng: customer.lng })
      workers.forEach(w => bounds.extend({ lat: w.current_lat, lng: w.current_lng }))
      if (!bounds.isEmpty()) map.fitBounds(bounds, 80)
    }
  }, [isLoaded, customer, workers, selectedWorkerId, onSelectWorker])

  function fitAll() {
    if (!mapRef.current) return
    const bounds = new google.maps.LatLngBounds()
    if (customer) bounds.extend({ lat: customer.lat, lng: customer.lng })
    workers.forEach(w => bounds.extend({ lat: w.current_lat, lng: w.current_lng }))
    if (!bounds.isEmpty()) mapRef.current.fitBounds(bounds, 80)
  }

  function goToCustomer() {
    if (!mapRef.current || !customer) return
    mapRef.current.panTo({ lat: customer.lat, lng: customer.lng })
    mapRef.current.setZoom(16)
    openInfoRef.current?.close()
    custInfoRef.current?.open(mapRef.current, custMarkerRef.current!)
    openInfoRef.current = custInfoRef.current
  }

  const available = workers.filter(w => workerStatus(w).key === 'ready').length
  const busy      = workers.filter(w => workerStatus(w).key === 'busy').length

  return (
    <div className={`rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm transition-all ${isFullscreen ? 'fixed inset-4 z-50 shadow-2xl' : ''}`}>

      {/* ── Map header bar ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100"
        style={{ background: 'linear-gradient(135deg,#F0FDFF,#EFF6FF)' }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm"
            style={{ background: 'linear-gradient(135deg,#0891B2,#0E7490)' }}>🗺</div>
          <div>
            <p className="text-[12px] font-black text-slate-800">Live Worker Map</p>
            <p className="text-[10px] text-slate-400">
              {workers.length} workers · {available} available · {busy} busy
              {lastUpdate && <span> · Updated {agoStr(lastUpdate.toISOString())}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Fit all */}
          <button onClick={fitAll} title="Fit all markers"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs bg-white border border-slate-200 hover:bg-slate-50 transition-all hover:scale-105 shadow-sm">
            ⊞
          </button>
          {/* Go to customer */}
          <button onClick={goToCustomer} title="Center on customer"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 transition-all hover:scale-105 shadow-sm">
            🏠
          </button>
          {/* Map type toggle */}
          <button
            onClick={() => {
              const next = mapType === 'roadmap' ? 'satellite' : 'roadmap'
              setMapType(next)
              mapRef.current?.setMapTypeId(next)
            }}
            title="Toggle satellite view"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs bg-white border border-slate-200 hover:bg-slate-50 transition-all hover:scale-105 shadow-sm">
            🛰
          </button>
          {/* Zoom in */}
          <button onClick={() => { const z = (mapRef.current?.getZoom() ?? 13) + 1; mapRef.current?.setZoom(z); setZoom(z) }}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-black bg-white border border-slate-200 hover:bg-slate-50 transition-all shadow-sm">+</button>
          {/* Zoom out */}
          <button onClick={() => { const z = (mapRef.current?.getZoom() ?? 13) - 1; mapRef.current?.setZoom(z); setZoom(z) }}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-black bg-white border border-slate-200 hover:bg-slate-50 transition-all shadow-sm">−</button>
          {/* Fullscreen */}
          <button onClick={() => setIsFullscreen(f => !f)} title="Toggle fullscreen"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs bg-white border border-slate-200 hover:bg-slate-50 transition-all hover:scale-105 shadow-sm">
            {isFullscreen ? '⊠' : '⊡'}
          </button>
        </div>
      </div>

      {/* ── Map canvas ── */}
      <div style={{ height: isFullscreen ? 'calc(100% - 220px)' : '320px' }} className="bg-slate-100 relative">
        {isLoaded && (customer || workers.length) ? (
          <GoogleMap
            mapContainerStyle={{ width: '100%', height: '100%' }}
            center={customer ? { lat: customer.lat, lng: customer.lng } : { lat: 19.076, lng: 72.8777 }}
            zoom={zoom}
            onLoad={m => { mapRef.current = m }}
            onZoomChanged={() => setZoom(mapRef.current?.getZoom() ?? 13)}
            options={{
              streetViewControl: true,
              mapTypeControl: false,
              fullscreenControl: false,
              zoomControl: false, // using custom controls
              styles: MAP_STYLES,
              gestureHandling: 'greedy',
              clickableIcons: false,
            }}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-3">
            {loading
              ? <>
                  <div className="w-8 h-8 rounded-full border-3 border-t-transparent animate-spin"
                    style={{ border: '3px solid #E2E8F0', borderTopColor: '#0891B2' }}/>
                  <p className="text-xs text-slate-400 font-medium">Loading map…</p>
                </>
              : <>
                  <p className="text-3xl">🗺️</p>
                  <p className="text-sm font-bold text-slate-600">No location data</p>
                  <p className="text-xs text-slate-400">Workers need to share location to appear here</p>
                  <button onClick={load}
                    className="mt-1 px-4 py-1.5 rounded-xl text-xs font-bold text-white"
                    style={{ background: 'linear-gradient(135deg,#0891B2,#0E7490)' }}>
                    Retry
                  </button>
                </>
            }
          </div>
        )}

        {/* Zoom level badge */}
        <div className="absolute bottom-3 left-3 px-2 py-1 rounded-lg text-[10px] font-bold bg-white/90 border border-slate-200 text-slate-500 shadow-sm">
          Zoom {zoom}
        </div>

        {/* Live pulse indicator */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/90 border border-slate-200 shadow-sm">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"/>
          <span className="text-[10px] font-bold text-slate-600">Live · 10s refresh</span>
        </div>
      </div>

      {/* ── Legend bar ── */}
      <div className="flex items-center flex-wrap gap-x-4 gap-y-1 px-4 py-2 border-b border-slate-100 bg-slate-50/50 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full border-2 border-white shadow-sm" style={{ background: CUSTOMER_COLOR }}/> Customer
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full border-2 border-white shadow-sm" style={{ background: '#10B981' }}/> Available ({available})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full border-2 border-white shadow-sm" style={{ background: '#F59E0B' }}/> Busy ({busy})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full border-2 border-white shadow-sm" style={{ background: '#94A3B8' }}/> Off shift
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full border-2 border-white shadow-sm" style={{ background: SELECTED_COLOR }}/> Selected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full border-2 border-white shadow-sm flex items-center justify-center text-[8px] font-black text-white" style={{ background: CONFLICT_COLOR }}>!</span> Time conflict
        </span>
        <button onClick={load}
          className="ml-auto flex items-center gap-1 text-[10px] font-bold text-cyan-600 hover:text-cyan-700 transition-colors">
          ↻ Refresh
        </button>
      </div>

      {/* ── Ranked worker list ── */}
      <div className={`overflow-y-auto divide-y divide-slate-50 ${isFullscreen ? 'max-h-48' : 'max-h-56'}`}>
        {workers.length === 0 && !loading && (
          <div className="px-4 py-6 text-center">
            <p className="text-2xl mb-2">👷</p>
            <p className="text-sm font-bold text-slate-600">No live workers right now</p>
            <p className="text-[11px] text-slate-400 mt-1">Only on-shift workers sharing location appear here</p>
          </div>
        )}
        {workers.map((w, i) => {
          const selected = w.user_id === selectedWorkerId
          const st = workerStatus(w)
          const ago = agoStr(w.location_updated_at)
          return (
            <button key={w.user_id} onClick={() => {
                onSelectWorker?.(w.user_id)
                // Pan map to this worker
                if (mapRef.current) {
                  mapRef.current.panTo({ lat: w.current_lat, lng: w.current_lng })
                  mapRef.current.setZoom(15)
                  openInfoRef.current?.close()
                  const info = workerInfosRef.current.get(w.user_id)
                  const marker = workerMarkersRef.current.get(w.user_id)
                  if (info && marker) { info.open(mapRef.current, marker); openInfoRef.current = info }
                }
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all ${
                selected
                  ? 'bg-blue-50 border-l-2 border-blue-500'
                  : w.has_time_conflict
                    ? 'bg-red-50/40 hover:bg-red-50 border-l-2 border-transparent'
                    : 'hover:bg-slate-50 border-l-2 border-transparent'
              }`}>
              {/* Rank badge */}
              <div className="w-7 h-7 rounded-xl flex items-center justify-center text-[11px] font-black flex-shrink-0 shadow-sm"
                style={{
                  background: i === 0
                    ? 'linear-gradient(135deg,#0891B2,#0E7490)'
                    : selected ? 'linear-gradient(135deg,#2563EB,#1D4ED8)' : '#F1F5F9',
                  color: i === 0 || selected ? '#fff' : '#64748B',
                }}>
                {i === 0 ? '★' : i + 1}
              </div>
              {/* Status dot */}
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 shadow-sm border border-white"
                style={{ background: selected ? SELECTED_COLOR : st.color }}/>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className={`text-[13px] font-bold truncate ${selected ? 'text-blue-700' : 'text-slate-800'}`}>
                    {w.full_name}
                  </p>
                  {w.is_verified && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 flex-shrink-0">✓ Verified</span>}
                  {w.has_time_conflict && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 flex-shrink-0">⚠️ Conflict</span>}
                </div>
                <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <span style={{ color: st.color, fontWeight: 700 }}>{st.emoji} {st.label}</span>
                  <span className="text-slate-300">·</span>
                  <span>{w.phone}</span>
                  {ago && <><span className="text-slate-300">·</span><span>{ago}</span></>}
                </p>
                {w.has_time_conflict && w.conflict_detail && (
                  <p className="text-[10.5px] font-semibold text-red-600 mt-0.5">
                    ⚠️ {w.conflict_detail}
                  </p>
                )}
              </div>
              {/* Distance */}
              <div className="text-right flex-shrink-0">
                <p className={`text-[14px] font-black ${selected ? 'text-blue-700' : 'text-slate-700'}`}>
                  {w.distance_km.toFixed(1)} km
                </p>
                {selected
                  ? <p className="text-[10px] font-black text-blue-600">✓ Selected</p>
                  : i === 0
                    ? <p className="text-[10px] font-bold text-cyan-600">Nearest</p>
                    : null}
              </div>
            </button>
          )
        })}
      </div>

      {/* Fullscreen backdrop close */}
      {isFullscreen && (
        <button onClick={() => setIsFullscreen(false)}
          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 shadow-md z-10">
          ✕
        </button>
      )}
    </div>
  )
}