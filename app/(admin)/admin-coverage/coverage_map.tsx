'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { GoogleMap, useJsApiLoader } from '@react-google-maps/api'
import { GOOGLE_MAPS_LOADER_OPTIONS } from '@/lib/googleMapsLoader'

type Worker = {
  user_id: string
  name: string
  lat: number
  lng: number
  updatedAt: string | null
  verified: boolean
}

const MUMBAI = { lat: 19.076, lng: 72.8777 }
const STALE_MS = 2 * 60 * 1000
const POLL_MS = 10000

const containerStyle = { width: '100%', height: '100%' }

export default function CoverageMap() {
  // Uses the shared loader config (same id/options as every other admin
  // page) — required by @react-google-maps/api's singleton loader, see
  // lib/googleMapsLoader.ts.
  const { isLoaded } = useJsApiLoader(GOOGLE_MAPS_LOADER_OPTIONS)

  const [workers, setWorkers] = useState<Map<string, Worker>>(new Map())
  const [, setTick] = useState(0)
  const mapRef = useRef<google.maps.Map | null>(null)
  const infoRef = useRef<google.maps.InfoWindow | null>(null)
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map())

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
        marker = new google.maps.Marker({ position: pos, map, icon, title: w.name })
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

  const activeCount = useMemo(() => {
    const now = Date.now()
    let n = 0
    workers.forEach((w) => {
      if (w.updatedAt && now - new Date(w.updatedAt).getTime() <= STALE_MS) n++
    })
    return n
  }, [workers])

  return (
    <div className="flex flex-col h-full">
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
              Live Worker Locations
            </p>
            <p className="text-[11px] text-slate-400 mt-1 font-semibold">
              on-shift workers only
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cyan-50 border border-cyan-100">
          <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
          <span className="text-xs font-black text-cyan-700">
            {activeCount} active
          </span>
        </span>
      </div>

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