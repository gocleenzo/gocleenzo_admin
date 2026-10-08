'use client'
// app/(admin)/admin-service-coverage/page.tsx
//
// 📍 SERVICE COVERAGE — one place for:
//   • where orders can come from (pincode: Whole / Only inside zones / Blocked)
//   • map zones (coverage + 🚫 excluded), drawn right here
//   • which professionals serve each pincode and each zone
//   • "By professional" view — everything one professional covers
//   • area health warnings + the STRICT switch
//   • 🧪 test any spot on the map
//
// Rule for who can take an order (same rule the database enforces when
// STRICT is ON — see coverage_team.sql):
//   inside a zone with its own team → that team
//   else the pincode's team
//   else anyone (STRICT off) / nobody (STRICT on)
//
// Replaces the old Service Areas and Service Zones pages.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GoogleMap, Marker, Polygon, useJsApiLoader } from '@react-google-maps/api'
import { createClient } from '@/lib/supabase/client'
import { GOOGLE_MAPS_LOADER_OPTIONS } from '@/lib/googleMapsLoader'

/* ───────────────────────── types ───────────────────────── */
type LatLng = { lat: number; lng: number }
type Area = {
  id: string; country: string | null; state: string | null; city: string | null
  area: string | null; parent_area: string | null; pincode: string | null
  is_active: boolean; coverage_mode: 'whole' | 'zones_only' | null
}
type Zone = {
  id: string; name: string; polygon: LatLng[]; is_active: boolean
  is_exclusion: boolean; pincode: string | null
}
type Pro = {
  id: string; name: string; phone: string; available: boolean
  base: LatLng | null
}
type Stat = { pincode: string; upcoming_7d: number; last_30d: number; center_lat: number | null; center_lng: number | null }
type Setting = 'whole' | 'zones_only' | 'blocked'
type Picker = { kind: 'pincode'; pincode: string; center: LatLng | null; title: string }
            | { kind: 'zone'; zoneId: string; center: LatLng | null; title: string }
type TestResult = {
  point: LatLng; pincode: string | null; ok: boolean; reason: string
  mode: string; zoneName: string | null; teamNames: string[]
}

/* ───────────────────────── theme ───────────────────────── */
const C = {
  cyan: '#0891B2', cyanDk: '#0E7490', cyanBg: '#ECFEFF',
  green: '#047857', greenBg: '#ECFDF5', red: '#B91C1C', redBg: '#FEF2F2',
  amber: '#B45309', amberBg: '#FFFBEB', violet: '#6D28D9', violetBg: '#F5F3FF',
  ink: '#0F172A', body: '#475569', muted: '#64748B', faint: '#94A3B8', line: '#E2E8F0', page: '#F8FAFC',
}
const SETTINGS: { key: Setting; label: string; color: string; bg: string }[] = [
  { key: 'whole', label: 'Whole pincode', color: C.green, bg: '#D1FAE5' },
  { key: 'zones_only', label: 'Only inside zones', color: C.cyanDk, bg: '#CFFAFE' },
  { key: 'blocked', label: 'Blocked', color: C.red, bg: '#FEE2E2' },
]
const MUMBAI = { lat: 19.076, lng: 72.8777 }
const PIN_RE = /^[1-9][0-9]{5}$/

/* ───────────────────────── helpers ───────────────────────── */
function settingOf(a: Area): Setting {
  if (!a.is_active) return 'blocked'
  return a.coverage_mode === 'zones_only' ? 'zones_only' : 'whole'
}
function km(a: LatLng | null, b: LatLng | null): number | null {
  if (!a || !b) return null
  const R = 6371, r = (d: number) => (d * Math.PI) / 180
  const x = Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}
function centroid(poly: LatLng[]): LatLng | null {
  if (!poly?.length) return null
  return {
    lat: poly.reduce((s, p) => s + p.lat, 0) / poly.length,
    lng: poly.reduce((s, p) => s + p.lng, 0) / poly.length,
  }
}
function dashed(color: string, scale = 3.5) {
  return {
    strokeOpacity: 0,
    icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: color, strokeWeight: 3, scale }, offset: '0', repeat: '14px' }],
  }
}

/* ───────────────────────── page ───────────────────────── */
export default function ServiceCoveragePage() {
  const supabase = createClient()
  const { isLoaded } = useJsApiLoader(GOOGLE_MAPS_LOADER_OPTIONS)

  const [areas, setAreas] = useState<Area[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [pros, setPros] = useState<Pro[]>([])
  const [pinTeams, setPinTeams] = useState<{ worker_id: string; pincode: string }[]>([])
  const [zoneTeams, setZoneTeams] = useState<{ worker_id: string; zone_id: string }[]>([])
  const [stats, setStats] = useState<Record<string, Stat>>({})
  const [strict, setStrict] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [setupMissing, setSetupMissing] = useState(false)

  const [tab, setTab] = useState<'area' | 'pro'>('area')
  const [search, setSearch] = useState('')
  const [openPin, setOpenPin] = useState<string | null>(null)
  const [focusZone, setFocusZone] = useState<string | null>(null)
  const [selPro, setSelPro] = useState<string>('')
  const [picker, setPicker] = useState<Picker | null>(null)
  const [healthFilter, setHealthFilter] = useState<'all' | 'red' | 'orange'>('all')

  // add pincode
  const [newPin, setNewPin] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newGroup, setNewGroup] = useState('')

  // drawing
  const [drawing, setDrawing] = useState(false)
  const [draft, setDraft] = useState<LatLng[]>([])
  const [draftName, setDraftName] = useState('')
  const [draftExcl, setDraftExcl] = useState(false)
  const [draftPin, setDraftPin] = useState('')
  const [savingZone, setSavingZone] = useState(false)

  // test
  const [testMode, setTestMode] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<TestResult | null>(null)

  const [mapType, setMapType] = useState<'roadmap' | 'hybrid'>('roadmap')
  const mapRef = useRef<google.maps.Map | null>(null)
  const geocoderRef = useRef<google.maps.Geocoder | null>(null)

  /* ── load ── */
  const load = useCallback(async () => {
    setErr(null)
    try {
      const [a, z, w, wp, zw, cs, st] = await Promise.all([
        supabase.from('service_areas').select('*').order('pincode'),
        supabase.from('service_zones').select('id,name,polygon,is_active,is_exclusion,pincode').order('created_at', { ascending: false }),
        supabase.from('workers').select('user_id,is_available,base_lat,base_lng,current_lat,current_lng,users(full_name,phone,is_active)'),
        supabase.from('worker_pincodes').select('worker_id,pincode'),
        supabase.from('zone_workers').select('worker_id,zone_id'),
        supabase.from('coverage_settings').select('strict').eq('id', 1).maybeSingle(),
        supabase.rpc('coverage_area_stats'),
      ])
      if (a.error) throw a.error
      setAreas((a.data ?? []) as Area[])
      setZones(((z.data ?? []) as any[]).map(r => ({ ...r, polygon: Array.isArray(r.polygon) ? r.polygon : [] })))
      setPros(((w.data ?? []) as any[])
        .filter(r => r.users?.is_active !== false)
        .map(r => {
          const lat = r.base_lat ?? r.current_lat, lng = r.base_lng ?? r.current_lng
          return {
            id: String(r.user_id),
            name: r.users?.full_name || 'Professional',
            phone: r.users?.phone || '',
            available: r.is_available !== false,
            base: lat != null && lng != null ? { lat: Number(lat), lng: Number(lng) } : null,
          }
        })
        .sort((x, y) => x.name.localeCompare(y.name)))
      setPinTeams(((wp.data ?? []) as any[]).map(r => ({ worker_id: String(r.worker_id), pincode: String(r.pincode) })))
      setZoneTeams(((zw.data ?? []) as any[]).map(r => ({ worker_id: String(r.worker_id), zone_id: String(r.zone_id) })))
      setSetupMissing(!!cs.error || !!st.error)
      setStrict(!!(cs.data as any)?.strict)
      const sm: Record<string, Stat> = {}
      ;((st.data ?? []) as any[]).forEach(s => { sm[s.pincode] = s as Stat })
      setStats(sm)
    } catch (e: any) {
      setErr(e?.message ?? 'Could not load coverage')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { load() }, [load])

  /* ── derived ── */
  const proById = useMemo(() => new Map(pros.map(p => [p.id, p])), [pros])
  const teamOfPin = useCallback((pin: string) =>
    pinTeams.filter(t => t.pincode === pin).map(t => t.worker_id), [pinTeams])
  const teamOfZone = useCallback((zid: string) =>
    zoneTeams.filter(t => t.zone_id === zid).map(t => t.worker_id), [zoneTeams])
  const zonesOfPin = useCallback((pin: string) => zones.filter(z => z.pincode === pin), [zones])

  const health = useCallback((a: Area): 'red' | 'orange' | 'ok' | 'off' => {
    if (settingOf(a) === 'blocked' || !a.pincode) return 'off'
    const pinTeam = teamOfPin(a.pincode).length
    const zoneTeam = zonesOfPin(a.pincode).some(z => z.is_active && !z.is_exclusion && teamOfZone(z.id).length > 0)
    if (pinTeam === 0 && !zoneTeam) return 'red'
    if (pinTeam === 1) return 'orange'
    return 'ok'
  }, [teamOfPin, zonesOfPin, teamOfZone])

  const redCount = areas.filter(a => health(a) === 'red').length
  const orangeCount = areas.filter(a => health(a) === 'orange').length
  const unlinkedZones = zones.filter(z => !z.pincode || !areas.some(a => a.pincode === z.pincode))

  const visibleAreas = useMemo(() => {
    const q = search.trim().toLowerCase()
    return areas
      .filter(a => !q || (a.pincode ?? '').includes(q) || (a.area ?? '').toLowerCase().includes(q) || (a.parent_area ?? '').toLowerCase().includes(q))
      .filter(a => healthFilter === 'all' || health(a) === healthFilter)
      .sort((x, y) => {
        const rank = (h: string) => (h === 'red' ? 0 : h === 'orange' ? 1 : h === 'ok' ? 2 : 3)
        return rank(health(x)) - rank(health(y)) || (x.pincode ?? '').localeCompare(y.pincode ?? '')
      })
  }, [areas, search, healthFilter, health])

  const centerOfPin = useCallback((pin: string): LatLng | null => {
    const z = zonesOfPin(pin).find(z => z.polygon.length >= 3)
    if (z) return centroid(z.polygon)
    const s = stats[pin]
    return s && s.center_lat != null && s.center_lng != null ? { lat: s.center_lat, lng: s.center_lng } : null
  }, [zonesOfPin, stats])

  /* ── map focus ── */
  function fitPoly(poly: LatLng[]) {
    if (!mapRef.current || !poly.length) return
    const b = new google.maps.LatLngBounds()
    poly.forEach(p => b.extend(p))
    mapRef.current.fitBounds(b, 60)
  }
  function focusPincode(pin: string) {
    setOpenPin(o => (o === pin ? null : pin))
    setFocusZone(null)
    const zs = zonesOfPin(pin).filter(z => z.polygon.length >= 3)
    if (zs.length) fitPoly(zs.flatMap(z => z.polygon))
    else {
      const c = centerOfPin(pin)
      if (c && mapRef.current) { mapRef.current.panTo(c); mapRef.current.setZoom(14) }
    }
  }

  /* ── writes ── */
  async function run(label: string, fn: () => Promise<{ error: any }>, after?: () => void) {
    setErr(null)
    const { error } = await fn()
    if (error) {
      setErr(`${label}: ${error.message}`)
      await load()
      return false
    }
    after?.()
    return true
  }

  async function setSetting(a: Area, next: Setting) {
    if (settingOf(a) === next) return
    if (next === 'blocked' && !window.confirm(`Block ${a.pincode} (${a.area})? Customers there won't be able to book.`)) return
    const patch = next === 'blocked' ? { is_active: false } : { is_active: true, coverage_mode: next }
    setAreas(prev => prev.map(r => (r.id === a.id ? { ...r, ...patch } as Area : r)))
    await run('Could not change setting', async () => supabase.from('service_areas').update(patch).eq('id', a.id))
  }

  async function addPincode() {
    const pin = newPin.trim()
    if (!PIN_RE.test(pin)) { setErr('Enter a valid 6-digit pincode'); return }
    if (areas.some(a => a.pincode === pin)) { setErr(`${pin} is already added`); return }
    const ref = areas[0]
    const { data, error } = await supabase.from('service_areas').insert({
      country: ref?.country ?? 'India', state: ref?.state ?? 'Maharashtra', city: ref?.city ?? 'Mumbai',
      pincode: pin, area: newLabel.trim() || pin, parent_area: newGroup.trim() || null,
      is_active: true, coverage_mode: 'whole',
    }).select('*').single()
    if (error) { setErr(error.message); return }
    setAreas(prev => [...prev, data as Area])
    setNewPin(''); setNewLabel(''); setNewGroup('')
    setOpenPin(pin)
  }

  async function deletePincode(a: Area) {
    if (!window.confirm(`Remove ${a.pincode} (${a.area}) from the list? Its professionals' links for this pincode are removed too. (To stop orders but keep it, choose Blocked instead.)`)) return
    await run('Could not remove', async () => supabase.from('service_areas').delete().eq('id', a.id))
    if (a.pincode) await supabase.from('worker_pincodes').delete().eq('pincode', a.pincode)
    await load()
  }

  async function addToPincode(pin: string, wid: string) {
    if (pinTeams.some(t => t.pincode === pin && t.worker_id === wid)) return
    setPinTeams(prev => [...prev, { pincode: pin, worker_id: wid }])
    await run('Could not add', async () => supabase.from('worker_pincodes').insert({ pincode: pin, worker_id: wid }))
  }
  async function removeFromPincode(pin: string, wid: string) {
    setPinTeams(prev => prev.filter(t => !(t.pincode === pin && t.worker_id === wid)))
    await run('Could not remove', async () => supabase.from('worker_pincodes').delete().eq('pincode', pin).eq('worker_id', wid))
  }
  async function addToZone(zid: string, wid: string) {
    if (zoneTeams.some(t => t.zone_id === zid && t.worker_id === wid)) return
    setZoneTeams(prev => [...prev, { zone_id: zid, worker_id: wid }])
    await run('Could not add', async () => supabase.from('zone_workers').insert({ zone_id: zid, worker_id: wid }))
  }
  async function removeFromZone(zid: string, wid: string) {
    setZoneTeams(prev => prev.filter(t => !(t.zone_id === zid && t.worker_id === wid)))
    await run('Could not remove', async () => supabase.from('zone_workers').delete().eq('zone_id', zid).eq('worker_id', wid))
  }

  async function toggleZone(z: Zone) {
    setZones(prev => prev.map(r => (r.id === z.id ? { ...r, is_active: !r.is_active } : r)))
    await run('Could not change zone', async () => supabase.from('service_zones').update({ is_active: !z.is_active }).eq('id', z.id))
  }
  async function deleteZone(z: Zone) {
    if (!window.confirm(`Delete zone "${z.name}"? This cannot be undone.`)) return
    setZones(prev => prev.filter(r => r.id !== z.id))
    await supabase.from('zone_workers').delete().eq('zone_id', z.id)
    await run('Could not delete zone', async () => supabase.from('service_zones').delete().eq('id', z.id))
  }

  async function saveZone() {
    if (draft.length < 3) { setErr('Place at least 3 points'); return }
    if (!draftName.trim()) { setErr('Give the zone a name'); return }
    if (!draftExcl && draftPin && !PIN_RE.test(draftPin)) { setErr('Pincode must be 6 digits or empty'); return }
    setSavingZone(true)
    const { data, error } = await supabase.from('service_zones').insert({
      name: draftName.trim(), polygon: draft, is_active: true, is_exclusion: draftExcl,
      pincode: !draftExcl && draftPin ? draftPin : null,
    }).select('id,name,polygon,is_active,is_exclusion,pincode').single()
    setSavingZone(false)
    if (error) { setErr(error.message); return }
    setZones(prev => [data as Zone, ...prev])
    setDraft([]); setDraftName(''); setDraftExcl(false); setDraftPin('')
    if ((data as Zone).pincode) setOpenPin((data as Zone).pincode)
  }

  async function toggleStrict() {
    const next = !strict
    const msg = next
      ? (redCount > 0
          ? `Turn STRICT ON?\n\n${redCount} area(s) taking orders have NO professional. After this, nobody can be assigned there until you add professionals.\n\nAlso, assigning a professional outside her areas will be refused everywhere.`
          : 'Turn STRICT ON?\n\nAssigning a professional outside her areas will be refused everywhere (admin, Nearby jobs, phone bookings).')
      : 'Turn STRICT OFF?\n\nAny professional can be assigned anywhere again (areas without a team).'
    if (!window.confirm(msg)) return
    setStrict(next)
    await run('Could not change STRICT', async () =>
      supabase.from('coverage_settings').update({ strict: next, updated_at: new Date().toISOString() }).eq('id', 1))
  }

  /* ── map clicks ── */
  async function testPoint(pt: LatLng) {
    setTesting(true)
    let pincode: string | null = null
    try {
      if (!geocoderRef.current) geocoderRef.current = new google.maps.Geocoder()
      const res = await geocoderRef.current.geocode({ location: pt })
      for (const r of res.results) {
        const pc = r.address_components.find(c => c.types.includes('postal_code'))
        if (pc) { pincode = pc.long_name; break }
      }
    } catch { /* still test the point */ }
    const [cov, team] = await Promise.all([
      supabase.rpc('check_serviceable', { p_lat: pt.lat, p_lng: pt.lng, p_pincode: pincode }),
      supabase.rpc('allowed_workers_for_point', { p_lat: pt.lat, p_lng: pt.lng, p_pincode: pincode }),
    ])
    setTesting(false)
    if (cov.error) { setErr('Run coverage.sql and coverage_team.sql in Supabase first.'); return }
    const c = (cov.data ?? {}) as any, t = (team.data ?? {}) as any
    setTest({
      point: pt, pincode, ok: !!c.ok, reason: String(c.reason ?? ''),
      mode: String(t.mode ?? 'any'), zoneName: t.zone_name ?? c.zone_name ?? null,
      teamNames: ((t.worker_ids ?? []) as string[]).map(id => proById.get(String(id))?.name ?? 'Professional'),
    })
  }
  function onMapClick(e: google.maps.MapMouseEvent) {
    if (!e.latLng) return
    const pt = { lat: e.latLng.lat(), lng: e.latLng.lng() }
    if (drawing) { setDraft(d => [...d, pt]); return }
    if (testMode) testPoint(pt)
  }

  /* ── pro view helpers ── */
  const pro = selPro ? proById.get(selPro) ?? null : null
  const proPins = useMemo(() => new Set(pinTeams.filter(t => t.worker_id === selPro).map(t => t.pincode)), [pinTeams, selPro])
  const proZones = useMemo(() => new Set(zoneTeams.filter(t => t.worker_id === selPro).map(t => t.zone_id)), [zoneTeams, selPro])
  const areasCountOf = useCallback((wid: string) =>
    pinTeams.filter(t => t.worker_id === wid).length + zoneTeams.filter(t => t.worker_id === wid).length, [pinTeams, zoneTeams])

  useEffect(() => {
    if (tab !== 'pro' || !pro || !mapRef.current) return
    const pts: LatLng[] = []
    zones.filter(z => proZones.has(z.id) || (z.pincode && proPins.has(z.pincode))).forEach(z => pts.push(...z.polygon))
    proPins.forEach(pin => { const c = centerOfPin(pin); if (c) pts.push(c) })
    if (pro.base) pts.push(pro.base)
    if (pts.length > 1) fitPoly(pts)
    else if (pts.length === 1) { mapRef.current.panTo(pts[0]); mapRef.current.setZoom(14) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selPro, tab])

  /* ── zone colours on the map ── */
  function zoneStyle(z: Zone) {
    let color = z.is_exclusion ? '#DC2626' : z.is_active ? C.cyan : C.faint
    let fill = z.is_exclusion ? 0.1 : 0.07
    let width = 3.5
    if (tab === 'area' && (focusZone === z.id || (openPin && z.pincode === openPin))) { color = '#7C3AED'; fill = 0.16; width = 4.5 }
    if (tab === 'pro' && pro && !z.is_exclusion && (proZones.has(z.id) || (z.pincode && proPins.has(z.pincode)))) { color = '#059669'; fill = 0.2; width = 4.5 }
    return { fillColor: color, fillOpacity: fill, clickable: false, ...dashed(color, width) }
  }

  /* ───────────────────────── render ───────────────────────── */
  return (
    <div className="flex flex-col lg:flex-row lg:h-screen" style={{ background: C.page }}>
      {/* ═════ Sidebar ═════ */}
      <div className="w-full lg:w-[440px] shrink-0 lg:overflow-y-auto border-r bg-white" style={{ borderColor: C.line }}>
        <div className="p-5 space-y-4">
          <div>
            <h1 className="text-xl font-black" style={{ color: C.ink }}>📍 Service Coverage</h1>
            <p className="text-[12.5px] mt-1" style={{ color: C.muted }}>
              Where orders can come from, and which professionals serve each area.
            </p>
          </div>

          {setupMissing && (
            <div className="rounded-xl p-3 text-xs font-bold" style={{ background: C.amberBg, color: C.amber }}>
              ⚠ Run <code>coverage.sql</code> and then <code>coverage_team.sql</code> in Supabase to enable everything on this page.
            </div>
          )}
          {err && (
            <div className="rounded-xl p-3 text-xs font-bold flex justify-between gap-2" style={{ background: C.redBg, color: C.red }}>
              <span>{err}</span><button onClick={() => setErr(null)}>✕</button>
            </div>
          )}

          {/* STRICT + health */}
          <div className="rounded-2xl p-4 space-y-3" style={{ border: `1px solid ${C.line}` }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black" style={{ color: C.ink }}>Strict areas</p>
                <p className="text-[11px]" style={{ color: C.muted }}>
                  {strict
                    ? 'ON — only a professional assigned to the area can take its orders.'
                    : 'OFF — areas without a team can still get any professional. Turn on when every area has one.'}
                </p>
              </div>
              <button onClick={toggleStrict} disabled={setupMissing}
                className="relative w-12 h-7 rounded-full transition-colors shrink-0 disabled:opacity-40"
                style={{ background: strict ? C.cyan : '#CBD5E1' }}>
                <span className="absolute top-1 w-5 h-5 rounded-full bg-white transition-all" style={{ left: strict ? 26 : 4 }} />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                ['all', `All ${areas.length}`, C.body, C.page],
                ['red', `🔴 ${redCount} no professional`, C.red, C.redBg],
                ['orange', `🟠 ${orangeCount} only one`, C.amber, C.amberBg],
              ] as const).map(([k, label, color, bg]) => (
                <button key={k} onClick={() => setHealthFilter(k)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-black"
                  style={{ color, background: bg, outline: healthFilter === k ? `2px solid ${color}55` : 'none' }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div className="inline-flex p-1 rounded-xl w-full" style={{ background: '#EEF2F7' }}>
            {([['area', '🗺 By area'], ['pro', '👷 By professional']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)}
                className="flex-1 px-3 py-2 rounded-lg text-sm font-black transition-all"
                style={tab === k ? { background: '#fff', color: C.cyanDk, boxShadow: '0 1px 3px rgba(15,23,42,.12)' } : { color: C.muted }}>
                {l}
              </button>
            ))}
          </div>

          {/* Tools */}
          <div className="flex gap-2">
            <button onClick={() => { setDrawing(true); setTestMode(false); setTest(null); setDraft([]); setDraftPin(openPin ?? '') }}
              disabled={drawing || !isLoaded}
              className="flex-1 px-3 py-2 rounded-xl text-xs font-black text-white disabled:opacity-40" style={{ background: C.ink }}>
              ✏️ Draw zone
            </button>
            <button onClick={() => { setTestMode(v => !v); setTest(null) }} disabled={drawing}
              className="flex-1 px-3 py-2 rounded-xl text-xs font-black disabled:opacity-40"
              style={testMode ? { background: '#7C3AED', color: '#fff' } : { background: C.violetBg, color: C.violet }}>
              🧪 {testMode ? 'Stop testing' : 'Test a spot'}
            </button>
          </div>

          {/* Drawing panel */}
          {(drawing || draft.length > 0) && (
            <div className="rounded-2xl p-4 space-y-3" style={{ background: C.greenBg, border: '1px solid #A7F3D0' }}>
              <p className="text-xs font-black uppercase tracking-wide" style={{ color: C.green }}>
                {drawing ? `Drawing — ${draft.length} point${draft.length === 1 ? '' : 's'}` : `New zone — ${draft.length} points`}
              </p>
              {drawing ? (
                <>
                  <p className="text-[12px]" style={{ color: C.green }}>Click the map to place each corner (at least 3).</p>
                  <div className="flex gap-2">
                    <button onClick={() => setDraft(d => d.slice(0, -1))} disabled={!draft.length}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white disabled:opacity-40" style={{ color: C.green }}>Undo</button>
                    <button onClick={() => draft.length >= 3 && setDrawing(false)} disabled={draft.length < 3}
                      className="flex-1 px-3 py-1.5 rounded-lg text-xs font-black text-white disabled:opacity-40" style={{ background: C.green }}>Finish shape</button>
                    <button onClick={() => { setDrawing(false); setDraft([]) }}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white" style={{ color: C.muted }}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <input value={draftName} onChange={e => setDraftName(e.target.value)} placeholder="Zone name (e.g. Hanuman Road side)"
                    className="w-full px-3 py-2 rounded-xl text-sm bg-white outline-none" style={{ border: `1px solid ${C.line}` }} />
                  <div className="flex gap-2">
                    <button onClick={() => setDraftExcl(false)} className="flex-1 px-3 py-2 rounded-xl text-xs font-black"
                      style={!draftExcl ? { background: C.cyan, color: '#fff' } : { background: '#fff', color: C.muted }}>Coverage zone</button>
                    <button onClick={() => setDraftExcl(true)} className="flex-1 px-3 py-2 rounded-xl text-xs font-black"
                      style={draftExcl ? { background: '#DC2626', color: '#fff' } : { background: '#fff', color: C.muted }}>🚫 Excluded</button>
                  </div>
                  {!draftExcl && (
                    <input value={draftPin} onChange={e => setDraftPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="Pincode this zone belongs to (e.g. 400057)" inputMode="numeric"
                      className="w-full px-3 py-2 rounded-xl text-sm font-mono bg-white outline-none" style={{ border: `1px solid ${C.line}` }} />
                  )}
                  <div className="flex gap-2">
                    <button onClick={saveZone} disabled={savingZone}
                      className="flex-1 px-3 py-2 rounded-xl text-sm font-black text-white disabled:opacity-40" style={{ background: C.cyan }}>
                      {savingZone ? 'Saving…' : 'Save zone'}
                    </button>
                    <button onClick={() => setDraft([])} className="px-3 py-2 rounded-xl text-sm font-bold bg-white" style={{ color: C.muted }}>Discard</button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Test result */}
          {testMode && (
            <div className="rounded-2xl p-3" style={{ background: C.violetBg, border: '1px solid #DDD6FE' }}>
              {testing ? <p className="text-xs font-bold" style={{ color: C.violet }}>Checking…</p>
                : !test ? <p className="text-xs" style={{ color: C.violet }}>Click anywhere on the map.</p>
                : (
                  <div className="space-y-1">
                    <p className="text-sm font-black" style={{ color: test.ok ? C.green : C.red }}>
                      {test.ok ? '✅ Customers here can book' : '❌ Customers here cannot book'}
                    </p>
                    <p className="text-[11px]" style={{ color: C.body }}>
                      Pincode <b className="font-mono">{test.pincode ?? '—'}</b>{test.zoneName && <> · Zone <b>{test.zoneName}</b></>}
                      {!test.ok && <> · {test.reason.replace(/_/g, ' ')}</>}
                    </p>
                    {test.ok && (
                      <p className="text-[11px]" style={{ color: C.body }}>
                        👷 {test.mode === 'zone' ? 'Zone team: ' : test.mode === 'pincode' ? 'Pincode team: ' : ''}
                        {test.mode === 'any' ? <b style={{ color: C.amber }}>No team — any professional (strict off)</b>
                          : test.mode === 'none' ? <b style={{ color: C.red }}>No team — nobody can be assigned (strict on)</b>
                          : <b>{test.teamNames.join(', ') || '—'}</b>}
                      </p>
                    )}
                  </div>
                )}
            </div>
          )}

          {loading ? (
            <p className="text-sm text-center py-10" style={{ color: C.faint }}>Loading…</p>
          ) : tab === 'area' ? (
            /* ═════ BY AREA ═════ */
            <div className="space-y-3">
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search pincode or area…"
                className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={{ border: `1px solid ${C.line}` }} />

              {visibleAreas.map(a => {
                const pin = a.pincode ?? ''
                const h = health(a)
                const open = openPin === pin
                const team = teamOfPin(pin)
                const pinZones = zonesOfPin(pin)
                const st = stats[pin]
                return (
                  <div key={a.id} className="rounded-2xl overflow-hidden"
                    style={{ border: `1px solid ${open ? '#C4B5FD' : C.line}`, background: '#fff' }}>
                    <button onClick={() => focusPincode(pin)} className="w-full px-4 py-3 text-left flex items-center gap-3">
                      <span className="text-base">{h === 'red' ? '🔴' : h === 'orange' ? '🟠' : h === 'ok' ? '🟢' : '⚪'}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-black" style={{ color: C.ink }}>
                          <span className="font-mono">{pin || '——'}</span> · {a.area || '—'}
                        </span>
                        <span className="block text-[11px]" style={{ color: C.muted }}>
                          {SETTINGS.find(s => s.key === settingOf(a))?.label} · 👷 {team.length}
                          {pinZones.length > 0 && ` · ${pinZones.length} zone${pinZones.length > 1 ? 's' : ''}`}
                          {st && ` · ${st.upcoming_7d} upcoming`}
                        </span>
                      </span>
                      <span style={{ color: C.faint }}>{open ? '▴' : '▾'}</span>
                    </button>

                    {open && (
                      <div className="px-4 pb-4 space-y-3" style={{ borderTop: `1px dashed ${C.line}` }}>
                        {/* setting */}
                        <div className="flex flex-wrap gap-1.5 pt-3">
                          {SETTINGS.map(s => {
                            const on = settingOf(a) === s.key
                            return (
                              <button key={s.key} onClick={() => setSetting(a, s.key)}
                                className="px-2.5 py-1.5 rounded-lg text-[11px] font-black border"
                                style={on ? { background: s.bg, color: s.color, borderColor: s.color + '55' } : { color: C.muted, borderColor: C.line }}>
                                {on ? '● ' : ''}{s.label}
                              </button>
                            )
                          })}
                        </div>
                        {settingOf(a) === 'zones_only' && pinZones.filter(z => z.is_active && !z.is_exclusion).length === 0 && (
                          <p className="text-[11px] font-bold" style={{ color: C.amber }}>
                            ⚠ No active zone tagged {pin} — draw one, or no address here can book.
                          </p>
                        )}

                        {/* stats */}
                        {st && (
                          <p className="text-[11px]" style={{ color: C.muted }}>
                            📅 {st.upcoming_7d} orders in next 7 days · ✅ {st.last_30d} completed last 30 days
                          </p>
                        )}

                        {/* pincode team */}
                        <TeamBlock
                          title="Professionals for this pincode"
                          ids={team} proById={proById}
                          empty={settingOf(a) === 'blocked' ? 'Blocked — no team needed' : strict ? '🔴 No one — orders here cannot be assigned' : '🔴 No one — any professional can be assigned for now'}
                          onRemove={wid => removeFromPincode(pin, wid)}
                          onAdd={() => setPicker({ kind: 'pincode', pincode: pin, center: centerOfPin(pin), title: `${pin} · ${a.area}` })}
                        />

                        {/* zones inside */}
                        {pinZones.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: C.faint }}>Zones in {pin}</p>
                            {pinZones.map(z => (
                              <ZoneCard key={z.id} z={z} focused={focusZone === z.id}
                                team={teamOfZone(z.id)} proById={proById}
                                onFocus={() => { setFocusZone(z.id); fitPoly(z.polygon) }}
                                onToggle={() => toggleZone(z)} onDelete={() => deleteZone(z)}
                                onRemove={wid => removeFromZone(z.id, wid)}
                                onAdd={() => setPicker({ kind: 'zone', zoneId: z.id, center: centroid(z.polygon), title: z.name })} />
                            ))}
                          </div>
                        )}

                        <div className="flex justify-between pt-1">
                          <button onClick={() => { setDrawing(true); setTestMode(false); setDraft([]); setDraftPin(pin) }}
                            className="text-[11px] font-black" style={{ color: C.cyanDk }}>✏️ Draw a zone in {pin}</button>
                          <button onClick={() => deletePincode(a)} className="text-[11px] font-bold" style={{ color: C.red }}>Remove pincode</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
              {visibleAreas.length === 0 && <p className="text-sm text-center py-6" style={{ color: C.faint }}>Nothing matches.</p>}

              {/* zones not linked to a listed pincode */}
              {unlinkedZones.length > 0 && healthFilter === 'all' && (
                <div className="space-y-2 pt-2">
                  <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: C.faint }}>
                    Other zones (not tagged with a listed pincode)
                  </p>
                  {unlinkedZones.map(z => (
                    <ZoneCard key={z.id} z={z} focused={focusZone === z.id}
                      team={teamOfZone(z.id)} proById={proById}
                      onFocus={() => { setFocusZone(z.id); setOpenPin(null); fitPoly(z.polygon) }}
                      onToggle={() => toggleZone(z)} onDelete={() => deleteZone(z)}
                      onRemove={wid => removeFromZone(z.id, wid)}
                      onAdd={() => setPicker({ kind: 'zone', zoneId: z.id, center: centroid(z.polygon), title: z.name })} />
                  ))}
                </div>
              )}

              {/* add pincode */}
              <div className="rounded-2xl p-3 space-y-2" style={{ border: `1px dashed ${C.line}` }}>
                <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: C.faint }}>+ Add pincode</p>
                <div className="flex gap-2">
                  <input value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="400056" inputMode="numeric"
                    className="w-24 px-2.5 py-2 rounded-lg text-sm font-mono outline-none" style={{ border: `1px solid ${C.line}` }} />
                  <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Area name"
                    className="flex-1 min-w-0 px-2.5 py-2 rounded-lg text-sm outline-none" style={{ border: `1px solid ${C.line}` }} />
                </div>
                <div className="flex gap-2">
                  <input value={newGroup} onChange={e => setNewGroup(e.target.value)} placeholder="Group under (optional)"
                    className="flex-1 min-w-0 px-2.5 py-2 rounded-lg text-sm outline-none" style={{ border: `1px solid ${C.line}` }} />
                  <button onClick={addPincode} disabled={!PIN_RE.test(newPin)}
                    className="px-4 py-2 rounded-lg text-sm font-black text-white disabled:opacity-40" style={{ background: C.cyan }}>Add</button>
                </div>
              </div>
            </div>
          ) : (
            /* ═════ BY PROFESSIONAL ═════ */
            <div className="space-y-3">
              <select value={selPro} onChange={e => setSelPro(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm font-semibold outline-none bg-white" style={{ border: `1px solid ${C.line}` }}>
                <option value="">Choose a professional…</option>
                {pros.map(p => (
                  <option key={p.id} value={p.id}>{p.name} · {areasCountOf(p.id)} area{areasCountOf(p.id) === 1 ? '' : 's'}</option>
                ))}
              </select>

              {!pro ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: C.faint }}>Professionals with no area yet</p>
                  {pros.filter(p => areasCountOf(p.id) === 0).map(p => (
                    <button key={p.id} onClick={() => setSelPro(p.id)}
                      className="w-full text-left px-3 py-2 rounded-xl text-sm font-semibold"
                      style={{ background: C.amberBg, color: C.amber }}>👷 {p.name}</button>
                  ))}
                  {pros.every(p => areasCountOf(p.id) > 0) && <p className="text-xs" style={{ color: C.muted }}>Everyone has at least one area. 👍</p>}
                </div>
              ) : (
                <>
                  <div className="rounded-2xl p-3" style={{ background: C.greenBg }}>
                    <p className="text-sm font-black" style={{ color: C.green }}>👷 {pro.name}</p>
                    <p className="text-[11px]" style={{ color: C.green }}>
                      {pro.phone} · {proPins.size} pincode{proPins.size === 1 ? '' : 's'} · {proZones.size} zone{proZones.size === 1 ? '' : 's'}
                      {!pro.base && ' · no base location set'}
                    </p>
                  </div>
                  <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: C.faint }}>Pincodes (tick to assign)</p>
                  <div className="space-y-1">
                    {[...areas].sort((x, y) => {
                      const dx = km(pro.base, centerOfPin(x.pincode ?? '')) ?? 999, dy = km(pro.base, centerOfPin(y.pincode ?? '')) ?? 999
                      return Number(proPins.has(y.pincode ?? '')) - Number(proPins.has(x.pincode ?? '')) || dx - dy
                    }).map(a => {
                      const pin = a.pincode ?? ''
                      const on = proPins.has(pin)
                      const d = km(pro.base, centerOfPin(pin))
                      return (
                        <label key={a.id} className="flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer"
                          style={{ background: on ? C.greenBg : '#fff', border: `1px solid ${on ? '#A7F3D0' : C.line}` }}>
                          <input type="checkbox" checked={on}
                            onChange={() => (on ? removeFromPincode(pin, pro.id) : addToPincode(pin, pro.id))} />
                          <span className="flex-1 min-w-0 text-sm" style={{ color: C.ink }}>
                            <b className="font-mono">{pin}</b> · {a.area}
                            {settingOf(a) === 'blocked' && <span style={{ color: C.red }}> · blocked</span>}
                          </span>
                          {d != null && <span className="text-[11px]" style={{ color: C.faint }}>{d.toFixed(1)} km</span>}
                        </label>
                      )
                    })}
                  </div>
                  {zones.some(z => !z.is_exclusion) && (
                    <>
                      <p className="text-[11px] font-black uppercase tracking-wide pt-2" style={{ color: C.faint }}>Zones (only if she&apos;s in a zone&apos;s smaller team)</p>
                      <div className="space-y-1">
                        {zones.filter(z => !z.is_exclusion).map(z => {
                          const on = proZones.has(z.id)
                          const d = km(pro.base, centroid(z.polygon))
                          return (
                            <label key={z.id} className="flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer"
                              style={{ background: on ? C.greenBg : '#fff', border: `1px solid ${on ? '#A7F3D0' : C.line}` }}>
                              <input type="checkbox" checked={on}
                                onChange={() => (on ? removeFromZone(z.id, pro.id) : addToZone(z.id, pro.id))} />
                              <span className="flex-1 min-w-0 text-sm" style={{ color: C.ink }}>
                                {z.name}{z.pincode && <span className="font-mono" style={{ color: C.faint }}> · {z.pincode}</span>}
                                {!z.is_active && <span style={{ color: C.faint }}> · off</span>}
                              </span>
                              {d != null && <span className="text-[11px]" style={{ color: C.faint }}>{d.toFixed(1)} km</span>}
                            </label>
                          )
                        })}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ═════ Map ═════ */}
      <div className="flex-1 relative min-h-[520px] lg:min-h-0">
        <div className="absolute top-4 right-4 z-10 flex rounded-xl overflow-hidden shadow-lg">
          {(['roadmap', 'hybrid'] as const).map(t => (
            <button key={t} onClick={() => setMapType(t)} className="px-3.5 py-2 text-xs font-bold"
              style={{ background: mapType === t ? C.cyan : '#fff', color: mapType === t ? '#fff' : C.muted }}>
              {t === 'roadmap' ? '🗺 Map' : '🛰 Satellite'}
            </button>
          ))}
        </div>
        {(drawing || testMode) && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-full text-white text-xs font-bold shadow-lg"
            style={{ background: drawing ? C.ink : '#7C3AED' }}>
            {drawing ? 'Click the map to place points' : '🧪 Click the map to test a spot'}
          </div>
        )}
        {!isLoaded ? (
          <div className="w-full h-full min-h-[520px] flex items-center justify-center text-sm" style={{ color: C.faint }}>Loading map…</div>
        ) : (
          <GoogleMap
            mapContainerStyle={{ width: '100%', height: '100%', minHeight: 520 }}
            center={MUMBAI} zoom={12}
            onLoad={m => { mapRef.current = m }}
            onClick={onMapClick}
            options={{ streetViewControl: false, mapTypeControl: false, fullscreenControl: false,
              draggableCursor: drawing || testMode ? 'crosshair' : undefined, mapTypeId: mapType }}
          >
            {zones.map(z => z.polygon.length >= 3 && (
              <Polygon key={z.id} path={z.polygon} options={zoneStyle(z)} />
            ))}

            {/* professionals' base locations */}
            {pros.filter(p => p.base).map(p => {
              const inTeam = tab === 'pro' ? p.id === selPro
                : openPin ? teamOfPin(openPin).includes(p.id) || zonesOfPin(openPin).some(z => teamOfZone(z.id).includes(p.id))
                : false
              return (
                <Marker key={p.id} position={p.base!} title={p.name}
                  zIndex={inTeam ? 900 : 10}
                  icon={{ path: google.maps.SymbolPath.CIRCLE, scale: inTeam ? 8 : 5,
                    fillColor: inTeam ? '#059669' : '#64748B', fillOpacity: inTeam ? 1 : 0.6,
                    strokeColor: '#fff', strokeWeight: 2 }}
                  label={inTeam ? { text: p.name.split(' ')[0], color: '#065F46', fontSize: '11px', fontWeight: '800', className: 'mt-6' } : undefined}
                />
              )
            })}

            {/* draft */}
            {draft.length >= 2 && (
              <Polygon path={draft} options={{ fillColor: '#059669', fillOpacity: 0.1, clickable: false, ...dashed('#059669', 4) }} />
            )}
            {draft.map((p, i) => (
              <Marker key={`d${i}`} position={p} zIndex={1000}
                label={{ text: String(i + 1), color: '#fff', fontSize: '11px', fontWeight: '700' }}
                icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: i === 0 ? C.cyan : '#059669', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 }} />
            ))}

            {/* test pin */}
            {test && testMode && (
              <Marker position={test.point} zIndex={2000}
                icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: test.ok ? '#059669' : '#DC2626', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 }} />
            )}
          </GoogleMap>
        )}
      </div>

      {/* ═════ Professional picker ═════ */}
      {picker && (
        <ProPicker
          picker={picker} pros={pros}
          already={picker.kind === 'pincode' ? teamOfPin(picker.pincode) : teamOfZone(picker.zoneId)}
          areasCountOf={areasCountOf}
          onPick={wid => picker.kind === 'pincode' ? addToPincode(picker.pincode, wid) : addToZone(picker.zoneId, wid)}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}

/* ───────────────────────── pieces ───────────────────────── */
function TeamBlock({ title, ids, proById, empty, onRemove, onAdd }: {
  title: string; ids: string[]; proById: Map<string, Pro>; empty: string
  onRemove: (id: string) => void; onAdd: () => void
}) {
  return (
    <div>
      <p className="text-[11px] font-black uppercase tracking-wide mb-1.5" style={{ color: C.faint }}>{title}</p>
      <div className="flex flex-wrap gap-1.5 items-center">
        {ids.length === 0 && <span className="text-[11px] font-bold" style={{ color: C.red }}>{empty}</span>}
        {ids.map(id => (
          <span key={id} className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-[12px] font-bold"
            style={{ background: C.greenBg, color: C.green }}>
            👷 {proById.get(id)?.name ?? 'Professional'}
            <button onClick={() => onRemove(id)} className="w-4 h-4 rounded-full text-[10px] leading-none hover:bg-white" title="Remove">✕</button>
          </span>
        ))}
        <button onClick={onAdd} className="px-2.5 py-1 rounded-full text-[12px] font-black"
          style={{ background: C.cyanBg, color: C.cyanDk }}>+ Add</button>
      </div>
    </div>
  )
}

function ZoneCard({ z, focused, team, proById, onFocus, onToggle, onDelete, onRemove, onAdd }: {
  z: Zone; focused: boolean; team: string[]; proById: Map<string, Pro>
  onFocus: () => void; onToggle: () => void; onDelete: () => void
  onRemove: (id: string) => void; onAdd: () => void
}) {
  return (
    <div className="rounded-xl p-3 space-y-2"
      style={{ background: z.is_exclusion ? C.redBg : focused ? C.violetBg : C.page, border: `1px solid ${focused ? '#C4B5FD' : C.line}` }}>
      <div className="flex items-center gap-2">
        <button onClick={onFocus} className="flex-1 min-w-0 text-left text-sm font-black truncate"
          style={{ color: z.is_exclusion ? C.red : z.is_active ? C.cyanDk : C.faint }}>
          {z.is_exclusion ? '🚫 ' : '◇ '}{z.name}
          {z.pincode && <span className="font-mono text-[11px]" style={{ color: C.faint }}> · {z.pincode}</span>}
        </button>
        <button onClick={onToggle} className="relative w-9 h-5 rounded-full shrink-0" style={{ background: z.is_active ? C.cyan : '#CBD5E1' }}
          title={z.is_active ? 'On' : 'Off'}>
          <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{ left: z.is_active ? 18 : 2 }} />
        </button>
        <button onClick={onDelete} className="text-sm px-1" style={{ color: C.faint }} title="Delete">✕</button>
      </div>
      {!z.is_exclusion && (
        <TeamBlock title="Zone team (optional — overrides the pincode team inside this zone)"
          ids={team} proById={proById} empty="Uses the pincode team"
          onRemove={onRemove} onAdd={onAdd} />
      )}
    </div>
  )
}

function ProPicker({ picker, pros, already, areasCountOf, onPick, onClose }: {
  picker: Picker; pros: Pro[]; already: string[]
  areasCountOf: (id: string) => number
  onPick: (id: string) => void; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const list = pros
    .filter(p => !already.includes(p.id))
    .filter(p => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()) || p.phone.includes(q.trim()))
    .map(p => ({ p, d: km(picker.center, p.base) }))
    .sort((a, b) => (a.d ?? 9999) - (b.d ?? 9999) || a.p.name.localeCompare(b.p.name))

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(15,23,42,.35)' }} onClick={onClose} />
      <div className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-md rounded-2xl bg-white overflow-hidden"
        style={{ boxShadow: '0 20px 50px rgba(15,23,42,.25)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.line}` }}>
          <div>
            <p className="font-black" style={{ color: C.ink }}>Add professional</p>
            <p className="text-[11px]" style={{ color: C.muted }}>{picker.title} · nearest first</p>
          </div>
          <button onClick={onClose} style={{ color: C.muted }}>✕</button>
        </div>
        <div className="p-3">
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or phone…"
            className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={{ border: `1px solid ${C.line}`, background: C.page }} />
        </div>
        <div className="max-h-[50vh] overflow-y-auto pb-2">
          {list.map(({ p, d }) => (
            <button key={p.id} onClick={() => { onPick(p.id); onClose() }}
              className="w-full px-5 py-2.5 flex items-center gap-3 text-left hover:bg-slate-50">
              <span className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-black shrink-0"
                style={{ background: C.cyanBg, color: C.cyanDk }}>{p.name.slice(0, 1)}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold truncate" style={{ color: C.ink }}>
                  {p.name}{!p.available && <span className="text-[11px]" style={{ color: C.faint }}> · unavailable</span>}
                </span>
                <span className="block text-[11px]" style={{ color: C.faint }}>
                  {d != null ? `${d.toFixed(1)} km away` : 'no base location'} · covers {areasCountOf(p.id)} area{areasCountOf(p.id) === 1 ? '' : 's'}
                </span>
              </span>
              <span className="text-xs font-black" style={{ color: C.cyanDk }}>+ Add</span>
            </button>
          ))}
          {list.length === 0 && <p className="text-center text-sm py-6" style={{ color: C.faint }}>Everyone is already in this team.</p>}
        </div>
      </div>
    </>
  )
}
