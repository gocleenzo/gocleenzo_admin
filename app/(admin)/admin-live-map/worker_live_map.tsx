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

// NEW: one of today's bookings, plotted as a pin (distinct from the
// round worker dots) at its address's coordinates.
type Order = {
  id: string
  status: string
  scheduled_at: string
  final_amount: number
  customer_name: string
  customer_phone: string
  worker_name: string | null
  service: string
  total_services: number
  address: string
  area: string
  city: string
  pincode: string
  lat: number
  lng: number
}

const MUMBAI = { lat: 19.076, lng: 72.8777 }
const STALE_MS = 2 * 60 * 1000 // stale if no update in 2 min
const POLL_MS = 10000
const ORDERS_POLL_MS = 30000

// NEW: today's date in IST as 'YYYY-MM-DD', used as the default value
// for the orders date picker — matches how /api/bookings/today-map
// itself computes "today" when no ?date= is given.
function todayIST(): string {
  const now = new Date()
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`
}

const containerStyle = { width: '100%', height: '100%' }

// A teardrop "pin" icon built as an inline SVG data-URL image — a
// different, more reliable rendering path than a google.maps.Symbol
// with a custom vector path (which silently failed to draw in this
// setup). This renders as a plain <img>-backed marker icon, the same
// mechanism as a normal Google Maps pin, just with our own color and a
// 📦 glyph baked into the SVG itself so no separate marker label is
// needed.
function buildOrderPinIcon(color: string): google.maps.Icon {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42">
      <path d="M17 0C7.6 0 0 7.6 0 17c0 12.75 17 25 17 25s17-12.25 17-25C34 7.6 26.4 0 17 0z" fill="${color}" stroke="#ffffff" stroke-width="2"/>
      <circle cx="17" cy="17" r="10" fill="#ffffff"/>
      <text x="17" y="22" font-size="13" text-anchor="middle">📦</text>
    </svg>`.trim()
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(34, 42),
    anchor: new google.maps.Point(17, 42),
  }
}

const ORDER_STATUS_META: Record<string, { color: string; label: string }> = {
  pending:      { color: '#D97706', label: 'Pending — needs worker' },
  accepted:     { color: '#2563EB', label: 'Assigned' },
  otp_verified: { color: '#7C3AED', label: 'OTP Verified' },
  in_progress:  { color: '#0891B2', label: 'In Progress' },
  completed:    { color: '#16a34a', label: 'Completed' },
  cancelled:    { color: '#9CA3AF', label: 'Cancelled' },
}

// ── Status → colour + label ───────────────────────────────────
// red = location OFF (device toggle, no recent updates at all — the
//   worker app now blocks itself entirely in this state, see
//   LocationGate, so this is a hard, meaningful signal, not just "app
//   closed"), amber = busy, green = in shift + available,
// grey = location ON but simply off shift right now.
//
// NOTE: this map now only ever receives workers whose ACCOUNT is
// active (filtered server-side in /api/workers/live by users.is_active).
// A worker still shows here even if their location is off/stale — that
// just changes their dot to red, it doesn't remove them from the map.
function workerStatus(w: Worker, stale: boolean): { color: string; label: string } {
  if (stale)                       return { color: '#ef4444', label: '📍 Location Off' }
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
  // NEW: today's orders layer — off by default so the map opens exactly
  // as it did before this feature; toggled on with the header switch.
  const [orders, setOrders] = useState<Map<string, Order>>(new Map())
  const [showOrders, setShowOrders] = useState(false)
  // NEW: which day's orders to show — defaults to today (IST), changed
  // via the date picker that appears once the layer is switched on.
  const [ordersDate, setOrdersDate] = useState<string>(todayIST())
  const [, setTick] = useState(0)
  const mapRef = useRef<google.maps.Map | null>(null)
  const infoRef = useRef<google.maps.InfoWindow | null>(null)
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map())
  const orderMarkersRef = useRef<Map<string, google.maps.Marker>>(new Map())

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

  // NEW: loads today's orders only while the layer is switched on —
  // no point polling a list the admin isn't looking at.
  useEffect(() => {
    if (!showOrders) return
    let active = true
    async function load() {
      try {
        const res = await fetch(`/api/bookings/today-map?date=${ordersDate}`, { cache: 'no-store' })
        const json = await res.json()
        if (!active || !json.orders) return
        const map = new Map<string, Order>()
        for (const o of json.orders as Order[]) map.set(o.id, o)
        setOrders(map)
      } catch {
        /* keep last known */
      }
    }
    load()
    const t = setInterval(load, ORDERS_POLL_MS)
    return () => {
      active = false
      clearInterval(t)
    }
  }, [showOrders, ordersDate])

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
              ? 'Location never reported'
              : ago < 60
              ? `📍 Location updated ${ago}s ago`
              : `📍 Location updated ${Math.round(ago / 60)}m ago`
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

  // NEW: renders/updates the today's-orders pin layer, independent of
  // the worker-dot effect above so toggling orders on/off never
  // touches worker markers and vice versa.
  useEffect(() => {
    if (!isLoaded || !mapRef.current) return
    const map = mapRef.current
    if (!infoRef.current) infoRef.current = new google.maps.InfoWindow()

    if (!showOrders) {
      orderMarkersRef.current.forEach((marker) => marker.setMap(null))
      orderMarkersRef.current.clear()
      return
    }

    const seen = new Set<string>()

    orders.forEach((o) => {
      seen.add(o.id)
      const meta = ORDER_STATUS_META[o.status] ?? ORDER_STATUS_META.pending

      const icon = buildOrderPinIcon(meta.color)

      let marker = orderMarkersRef.current.get(o.id)
      if (!marker) {
        marker = new google.maps.Marker({
          position: { lat: o.lat, lng: o.lng },
          map,
          icon,
          title: `${o.service} — ${meta.label}`,
          zIndex: 999, // keep order pins above worker dots when overlapping
        })
        marker.addListener('click', () => {
          const cur = orders.get(o.id)
          if (!cur || !infoRef.current) return
          const curMeta = ORDER_STATUS_META[cur.status] ?? ORDER_STATUS_META.pending
          const time = new Date(cur.scheduled_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
          infoRef.current.setContent(
            `<div style="font-family:system-ui;font-size:13px;line-height:1.6;max-width:240px">
               <span style="color:${curMeta.color};font-weight:700">${curMeta.label}</span><br/>
               <strong>${cur.service}</strong> · ${time}<br/>
               <span style="color:#374151">${cur.customer_name} · ${cur.customer_phone}</span><br/>
               <span style="color:#6b7280">${cur.address}${cur.pincode ? ', ' + cur.pincode : ''}</span><br/>
               <span style="color:#374151">${cur.worker_name ? '👷 ' + cur.worker_name : '⏳ Unassigned'}</span><br/>
               <span style="color:#6b7280">₹${(cur.final_amount ?? 0).toLocaleString('en-IN')}</span>
             </div>`
          )
          infoRef.current.open({ anchor: marker!, map })
        })
        orderMarkersRef.current.set(o.id, marker)
      } else {
        marker.setPosition({ lat: o.lat, lng: o.lng })
        marker.setIcon(icon)
      }
    })

    orderMarkersRef.current.forEach((marker, id) => {
      if (!seen.has(id)) {
        marker.setMap(null)
        orderMarkersRef.current.delete(id)
      }
    })
  }, [orders, showOrders, isLoaded])

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
              Live Worker Map
            </p>
            <p className="text-[11px] text-slate-400 mt-1 font-semibold">
              Updates every 10s · active professionals
              {showOrders && (
                <> · orders for {new Date(ordersDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* NEW: today's-orders layer toggle */}
          <button
            onClick={() => setShowOrders((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black transition-all"
            style={{
              background: showOrders ? '#7C3AED14' : '#F1F5F9',
              color: showOrders ? '#7C3AED' : '#64748B',
              border: `1px solid ${showOrders ? '#7C3AED40' : '#E2E8F0'}`,
            }}
          >
            📦 {ordersDate === todayIST() ? "Today's Orders" : 'Orders'} {showOrders ? `(${orders.size})` : ''}
          </button>
          {/* NEW: date picker for the orders layer — only shown once the
              layer is on, so it doesn't clutter the header otherwise.
              Changing it refetches orders for that calendar day. */}
          {showOrders && (
            <input
              type="date"
              value={ordersDate}
              onChange={(e) => setOrdersDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-full text-xs font-bold text-slate-600 border border-slate-200 bg-white"
            />
          )}
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cyan-50 border border-cyan-100">
            <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
            <span className="text-xs font-black text-cyan-700">
              {counts.online} location on
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
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#9ca3af' }} /> Off shift (location still on)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#ef4444' }} /> 📍 Location off
        </span>
        {/* NEW: order-pin legend, shown only while the layer is on */}
        {showOrders && (
          <>
            <span className="text-slate-300">|</span>
            {Object.values(ORDER_STATUS_META).map((m) => (
              <span key={m.label} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: m.color }} /> {m.label}
              </span>
            ))}
          </>
        )}
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