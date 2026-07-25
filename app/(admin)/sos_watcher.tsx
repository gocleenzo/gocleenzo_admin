'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

type Alert = {
  id: string
  worker_id: string
  name: string
  phone: string
  lat: number | null
  lng: number | null
  booking_id: string | null
  status: string
  note: string | null
  created_at: string
}

/**
 * Global SOS watcher — mount once in the admin layout so it shows on every
 * page. Listens for new sos_alerts via realtime, pops an urgent modal with
 * the worker's location on a map, and plays a repeating alert sound until
 * the admin acknowledges or resolves.
 */
export default function SosWatcher() {
  const supabase = createClient()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [open, setOpen] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sos', { cache: 'no-store' })
      const json = await res.json()
      const active = (json.alerts ?? []) as Alert[]
      setAlerts(active)
      if (active.length > 0) setOpen(true)
    } catch {
      /* ignore */
    }
  }, [])

  // initial + realtime
  useEffect(() => {
    load()
    const ch = supabase
      .channel('sos_admin')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sos_alerts' },
        () => load()
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sos_alerts' },
        () => load()
      )
      .subscribe()
    // safety: poll every 20s in case realtime drops
    const t = setInterval(load, 20000)
    return () => {
      supabase.removeChannel(ch)
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // sound: loop while there are active alerts and modal is open
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    if (open && alerts.length > 0) {
      a.loop = true
      a.play().catch(() => {
        /* autoplay may be blocked until a user gesture; that's fine */
      })
    } else {
      a.pause()
      a.currentTime = 0
    }
  }, [open, alerts.length])

  async function resolve(id: string) {
    try {
      await fetch('/api/sos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
    } finally {
      load()
    }
  }

  if (!open || alerts.length === 0) {
    return (
      // audio element kept mounted so it's ready to play
      <audio ref={audioRef} src="/sos-alert.mp3" preload="auto" />
    )
  }

  return (
    <>
      <audio ref={audioRef} src="/sos-alert.mp3" preload="auto" />
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)' }}>
        <div className="w-full max-w-lg bg-white rounded-2xl overflow-hidden shadow-2xl">
          {/* header */}
          <div className="px-5 py-4 flex items-center gap-3"
            style={{ background: 'linear-gradient(135deg,#ef4444,#dc2626)' }}>
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-70" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-white" />
            </span>
            <div className="flex-1">
              <p className="text-white font-black text-lg leading-none">🚨 Emergency SOS</p>
              <p className="text-white/80 text-xs mt-1">
                {alerts.length} active alert{alerts.length > 1 ? 's' : ''}
              </p>
            </div>
            <button onClick={() => setOpen(false)}
              className="text-white/80 hover:text-white text-sm font-bold px-3 py-1 rounded-lg bg-white/15">
              Mute
            </button>
          </div>

          {/* alerts list */}
          <div className="max-h-[70vh] overflow-y-auto divide-y divide-slate-100">
            {alerts.map((a) => {
              const ago = Math.max(
                0,
                Math.round((Date.now() - new Date(a.created_at).getTime()) / 1000)
              )
              const agoText = ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`
              const hasLoc = a.lat != null && a.lng != null
              const mapsUrl = hasLoc
                ? `https://www.google.com/maps?q=${a.lat},${a.lng}`
                : null
              const embed = hasLoc
                ? `https://maps.google.com/maps?q=${a.lat},${a.lng}&z=16&output=embed`
                : null
              return (
                <div key={a.id} className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <p className="font-black text-slate-900 text-base">{a.name}</p>
                      <p className="text-sm text-slate-500">{a.phone || 'No phone'}</p>
                      <p className="text-[11px] text-red-600 font-bold mt-1">
                        Triggered {agoText}
                      </p>
                      {a.note && (
                        <p className="text-xs text-slate-600 mt-1 italic">“{a.note}”</p>
                      )}
                    </div>
                    {a.phone && (
                      <a href={`tel:${a.phone}`}
                        className="px-3 py-2 rounded-xl text-sm font-bold text-white shrink-0"
                        style={{ background: '#16a34a' }}>
                        📞 Call
                      </a>
                    )}
                  </div>

                  {/* map */}
                  {embed ? (
                    <div className="rounded-xl overflow-hidden border border-slate-200 mb-3">
                      <iframe
                        title={`sos-${a.id}`}
                        src={embed}
                        width="100%"
                        height="220"
                        style={{ border: 0 }}
                        loading="lazy"
                      />
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-400 mb-3">
                      No location captured for this alert
                    </div>
                  )}

                  <div className="flex gap-2">
                    {mapsUrl && (
                      <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                        className="flex-1 text-center px-3 py-2.5 rounded-xl text-sm font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors">
                        Open in Google Maps
                      </a>
                    )}
                    <button onClick={() => resolve(a.id)}
                      className="flex-1 px-3 py-2.5 rounded-xl text-sm font-black text-white transition-colors"
                      style={{ background: '#dc2626' }}>
                      Mark resolved
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}