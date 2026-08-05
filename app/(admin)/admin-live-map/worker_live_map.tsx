'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { GoogleMap, useJsApiLoader } from '@react-google-maps/api'
import { isWithinShift, type WeekSchedule } from '@/lib/shift'
import { GOOGLE_MAPS_LOADER_OPTIONS } from '@/lib/googleMapsLoader'

type Worker = {
  user_id: string
  name: string
  lat: number
  lng: number
  updatedAt: string | null
  verified: boolean
  available: boolean
  busy: boolean
  schedule: WeekSchedule | null
}

const MUMBAI = { lat: 19.076, lng: 72.8777 }
const STALE_MS = 2 * 60 * 1000 // stale if no update in 2 min
const POLL_MS = 10000

const containerStyle = { width: '100%', height: '100%' }

// ── Status → colour + label ───────────────────────────────────
// green = in shift + available, amber = busy, grey = off shift / stale
function workerStatus(w: Worker, stale: boolean): { color: string; label: string } {
  if (stale)                       return { color: '#9ca3af', label: 'Offline (stale)' }
  if (w.busy)                      return { color: '#f59e0b', label: 'Busy' }
  const inShift = isWithinShift(w.schedule)
  if (inShift && w.available)      return { color: '#16a34a', label: 'Available' }
  return { color: '#9ca3af', label: 'Off shift' }
}

export default function WorkerLiveMap() {
  // Uses the shared loader config (same id/options as every other admin
  // page that loads Google Maps) — required by @react-google-maps/api's
  // singleton loader; see lib/googleMapsLoader.ts.
  const { isLoaded } = useJsApiLoader(GOOGLE_MAPS_LOADER_OPTIONS)

  const [workers, setWorkers] = useState<Map<string, Worker>>(new Map())
  const [, setTick] = useState(0)
  const mapRef = useRef<google.maps.Map | null>(null)
  const infoRef = useRef<google.maps.InfoWindow | null>(null)
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map())

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

  // Re-render every 15s so staleness + shift colouring refreshes
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15000)
    return () => clearInterval(t)
  }, [])

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
      const st = workerStatus(w, stale)

      const icon: google.maps.Symbol = {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: st.color,
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
      }

      let marker = markersRef.current.get(w.user_id)
      if (!marker) {
        marker = new google.maps.Marker({
          position: { lat: w.lat, lng: w.lng },
          map,
          icon,
          title: `${w.name} — ${st.label}`,
        })
        marker.addListener('click', () => {
          const cur = workers.get(w.user_id)
          if (!cur || !infoRef.current) return
          const curStale =
            !cur.updatedAt || Date.now() - new Date(cur.updatedAt).getTime() > STALE_MS
          const curSt = workerStatus(cur, curStale)
          const ago = cur.updatedAt
            ? Math.round((Date.now() - new Date(cur.updatedAt).getTime()) / 1000)
            : null
          const agoText =
            ago == null
              ? 'No recent update'
              : ago < 60
              ? `Updated ${ago}s ago`
              : `Updated ${Math.round(ago / 60)}m ago`
          infoRef.current.setContent(
            `<div style="font-family:system-ui;font-size:13px;line-height:1.5">
               <strong>${cur.name}</strong>${cur.verified ? ' ✅' : ''}<br/>
               <span style="color:${curSt.color};font-weight:700">${curSt.label}</span><br/>
               <span style="color:#6b7280">${agoText}</span>
             </div>`
          )
          infoRef.current.open({ anchor: marker!, map })
        })
        markersRef.current.set(w.user_id, marker)
      } else {
        marker.setPosition({ lat: w.lat, lng: w.lng })
        marker.setIcon(icon)
      }
    })

    markersRef.current.forEach((marker, id) => {
      if (!seen.has(id)) {
        marker.setMap(null)
        markersRef.current.delete(id)
      }
    })
  }, [workers, isLoaded])

  const counts = useMemo(() => {
    const now = Date.now()
    let online = 0
    workers.forEach((w) => {
      if (w.updatedAt && now - new Date(w.updatedAt).getTime() <= STALE_MS) online++
    })
    return { online, total: workers.size }
  }, [workers])

  return (
    <div className="flex flex-col h-full">
      {/* header */}
      <div className="px-5 md:px-6 py-4 bg-white border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center text-lg"
            style={{ background: '#0891B214', border: '1px solid #0891B225' }}
          >
            📍
          </div>
          <div>
            <p className="font-black text-slate-900 text-lg leading-none tracking-tight">
              Live Worker Map
            </p>
            <p className="text-[11px] text-slate-400 mt-1 font-semibold">
              Updates every 10s
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cyan-50 border border-cyan-100">
            <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
            <span className="text-xs font-black text-cyan-700">
              {counts.online} online
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200">
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            <span className="text-xs font-bold text-slate-500">
              {counts.total} total
            </span>
          </span>
        </div>
      </div>

      {/* status legend */}
      <div className="px-5 md:px-6 py-2.5 bg-white border-b border-slate-100 flex items-center flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#16a34a' }} /> In shift &amp; available
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#f59e0b' }} /> Busy
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#9ca3af' }} /> Off shift / offline
        </span>
      </div>

      {/* map */}
      <div className="flex-1 min-h-[480px] bg-slate-100">
        {isLoaded ? (
          <GoogleMap
            mapContainerStyle={containerStyle}
            center={MUMBAI}
            zoom={12}
            onLoad={(m) => {
              mapRef.current = m
            }}
            options={{
              streetViewControl: false,
              mapTypeControl: false,
              fullscreenControl: false,
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