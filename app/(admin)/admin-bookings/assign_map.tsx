'use client'

import { useEffect, useRef, useState } from 'react'
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
}
type Customer = { lat: number; lng: number; area: string; city: string }

// green = in shift + available, amber = busy, grey = off shift
function workerStatus(w: LiveWorker): { key: string; color: string; label: string } {
  if (w.is_busy) return { key: 'busy', color: '#f59e0b', label: 'Busy' }
  const inShift = isWithinShift(w.schedule)
  if (inShift && w.is_available) return { key: 'ready', color: '#16a34a', label: 'Available' }
  return { key: 'offshift', color: '#9ca3af', label: 'Off shift' }
}
const SELECTED_COLOR = '#2563eb'
const CUSTOMER_COLOR = '#dc2626'

export default function AssignMap({
  bookingId,
  selectedWorkerId,
  onSelectWorker,
}: {
  bookingId: string
  selectedWorkerId?: string
  onSelectWorker?: (id: string) => void
}) {
  // Uses the shared loader config (same id/options as every other admin
  // page that loads Google Maps) — required by @react-google-maps/api's
  // singleton loader; see lib/googleMapsLoader.ts.
  const { isLoaded } = useJsApiLoader(GOOGLE_MAPS_LOADER_OPTIONS)

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [workers, setWorkers] = useState<LiveWorker[]>([])
  const [loading, setLoading] = useState(true)

  const mapRef = useRef<google.maps.Map | null>(null)
  const custMarkerRef = useRef<google.maps.Marker | null>(null)
  const workerMarkersRef = useRef<Map<string, google.maps.Marker>>(new Map())

  async function load() {
    try {
      const res = await fetch(`/api/workers/near-booking?booking_id=${bookingId}`, {
        cache: 'no-store',
      })
      const json = await res.json()
      setCustomer(json.customer ?? null)
      setWorkers((json.workers ?? []) as LiveWorker[])
    } catch {
      /* keep last */
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId])

  useEffect(() => {
    if (!isLoaded || !mapRef.current) return
    const map = mapRef.current

    if (customer) {
      const pos = { lat: customer.lat, lng: customer.lng }
      if (!custMarkerRef.current) {
        custMarkerRef.current = new google.maps.Marker({
          position: pos,
          map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 9,
            fillColor: CUSTOMER_COLOR,
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: 2.5,
          },
          title: `Customer — ${customer.area}`,
          zIndex: 999,
        })
      } else {
        custMarkerRef.current.setPosition(pos)
      }
    }

    const seen = new Set<string>()
    workers.forEach((w) => {
      seen.add(w.user_id)
      const selected = w.user_id === selectedWorkerId
      const st = workerStatus(w)
      const icon: google.maps.Symbol = {
        path: google.maps.SymbolPath.CIRCLE,
        scale: selected ? 10 : 7,
        fillColor: selected ? SELECTED_COLOR : st.color,
        fillOpacity: 1,
        strokeColor: '#fff',
        strokeWeight: 2,
      }
      let m = workerMarkersRef.current.get(w.user_id)
      if (!m) {
        m = new google.maps.Marker({
          position: { lat: w.current_lat, lng: w.current_lng },
          map,
          icon,
          title: `${w.full_name} — ${st.label} — ${w.distance_km.toFixed(1)} km`,
        })
        m.addListener('click', () => onSelectWorker?.(w.user_id))
        workerMarkersRef.current.set(w.user_id, m)
      } else {
        m.setPosition({ lat: w.current_lat, lng: w.current_lng })
        m.setIcon(icon)
      }
    })
    workerMarkersRef.current.forEach((m, id) => {
      if (!seen.has(id)) {
        m.setMap(null)
        workerMarkersRef.current.delete(id)
      }
    })

    if (customer || workers.length) {
      const bounds = new google.maps.LatLngBounds()
      if (customer) bounds.extend({ lat: customer.lat, lng: customer.lng })
      workers.forEach((w) => bounds.extend({ lat: w.current_lat, lng: w.current_lng }))
      if (!bounds.isEmpty()) map.fitBounds(bounds, 60)
    }
  }, [isLoaded, customer, workers, selectedWorkerId, onSelectWorker])

  return (
    <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white">
      {/* map */}
      <div className="h-80 bg-slate-100">
        {isLoaded && (customer || workers.length) ? (
          <GoogleMap
            mapContainerStyle={{ width: '100%', height: '100%' }}
            center={
              customer
                ? { lat: customer.lat, lng: customer.lng }
                : { lat: 19.076, lng: 72.8777 }
            }
            zoom={13}
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
          <div className="h-full flex items-center justify-center text-xs text-slate-400">
            {loading ? 'Loading map…' : 'No location data for this booking'}
          </div>
        )}
      </div>

      {/* legend */}
      <div className="flex items-center flex-wrap gap-x-4 gap-y-1 px-4 py-2 border-b border-slate-100 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: CUSTOMER_COLOR }} /> Customer
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#16a34a' }} /> Available
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#f59e0b' }} /> Busy
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#9ca3af' }} /> Off shift
        </span>
        <span className="ml-auto text-slate-400">{workers.length} live</span>
      </div>

      {/* ranked list */}
      <div className="max-h-64 overflow-y-auto divide-y divide-slate-50">
        {workers.length === 0 && !loading && (
          <div className="px-4 py-6 text-center">
            <p className="text-sm font-bold text-slate-600">No live workers right now</p>
            <p className="text-[11px] text-slate-400 mt-1">
              Only on-shift workers sharing location appear here.
            </p>
          </div>
        )}
        {workers.map((w, i) => {
          const selected = w.user_id === selectedWorkerId
          const st = workerStatus(w)
          const ago = w.location_updated_at
            ? Math.round((Date.now() - new Date(w.location_updated_at).getTime()) / 1000)
            : null
          return (
            <button
              key={w.user_id}
              onClick={() => onSelectWorker?.(w.user_id)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                selected ? 'bg-blue-50' : 'hover:bg-slate-50'
              }`}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0 border border-white shadow"
                style={{ background: selected ? SELECTED_COLOR : st.color }}
                title={st.label}
              />
              <span
                className={`w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-black shrink-0 ${
                  i === 0 ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-slate-800 truncate">{w.full_name}</p>
                <p className="text-[11px] text-slate-400">
                  <span style={{ color: st.color, fontWeight: 700 }}>{st.label}</span>
                  {' · '}{w.phone}
                  {ago != null && ` · ${ago < 60 ? `${ago}s` : `${Math.round(ago / 60)}m`} ago`}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[13px] font-black text-slate-700">{w.distance_km.toFixed(1)} km</p>
                {selected && <p className="text-[10px] font-bold text-blue-600">selected</p>}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}