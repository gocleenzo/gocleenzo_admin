'use client'
// app/(admin)/admin-services/page.tsx
// Services — card layout. Same data and saving as before (services +
// service_pincodes), arranged more simply:
//   • cards grouped by category, price & duration at a glance
//   • Show / hide switch right on each card
//   • warning when a service has no area (hidden from everyone)
//   • one side panel to edit price, duration, BHK prices and areas
// Extra-time price now lives on the 💳 Fees & charges page.
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Service = {
  id: string
  name: string
  category: string | null
  is_active: boolean
  base_price: number | null
  original_price: number | null
  duration_minutes: number | null
  price_1bhk: number | null
  price_2bhk: number | null
  price_3bhk: number | null
  duration_1bhk: number | null
  duration_2bhk: number | null
  duration_3bhk: number | null
  price_30min: number | null
  price_60min: number | null
  price_90min: number | null
}
type Area = { pincode: string; name: string }

const isBhk = (s: Service) => s.price_1bhk != null || s.price_2bhk != null || s.price_3bhk != null
const inr = (n: number | null | undefined) => n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN')
const mins = (m: number | null | undefined) => {
  if (m == null) return '—'
  const h = Math.floor(m / 60), r = m % 60
  return h === 0 ? `${r} min` : r === 0 ? `${h} hr` : `${h} hr ${r} min`
}
const offPct = (orig: number | null, offer: number | null) =>
  orig && offer && orig > offer ? Math.round(((orig - offer) / orig) * 100) : 0

const CAT_ICON: Record<string, string> = {
  cleaning: '🧹', kitchen: '🍳', bathroom: '🚿', home: '🏠', laundry: '👕', sofa: '🛋️',
  maid: '🧺', cook: '👩‍🍳', deep: '✨', car: '🚗', pest: '🐜',
}
function catIcon(c: string) {
  const k = Object.keys(CAT_ICON).find(x => c.toLowerCase().includes(x))
  return k ? CAT_ICON[k] : '🧾'
}

export default function AdminServices() {
  const supabase = createClient()
  const [services, setServices] = useState<Service[]>([])
  const [pinCount, setPinCount] = useState<Record<string, number>>({})
  const [areas, setAreas] = useState<Area[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('all')
  const [show, setShow] = useState<'all' | 'live' | 'hidden' | 'noarea'>('all')
  const [editing, setEditing] = useState<Service | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  async function load() {
    const [{ data, error }, { data: pins }, { data: areaRows }] = await Promise.all([
      supabase.from('services')
        .select('id,name,category,is_active,base_price,original_price,duration_minutes,price_1bhk,price_2bhk,price_3bhk,duration_1bhk,duration_2bhk,duration_3bhk,price_30min,price_60min,price_90min')
        .order('category').order('name'),
      supabase.from('service_pincodes').select('service_id'),
      supabase.from('service_areas').select('*'),
    ]) as any[]
    if (error) { setLoadError(error.message) } else { setServices(data ?? []); setLoadError(null) }
    const c: Record<string, number> = {}
    ;(pins ?? []).forEach((p: any) => { c[p.service_id] = (c[p.service_id] ?? 0) + 1 })
    setPinCount(c)
    setAreas((areaRows ?? []).map((a: any) => ({
      pincode: String(a.pincode ?? '').replace(/\D/g, '').slice(-6),
      name: a.area_name ?? a.name ?? a.area ?? a.locality ?? '',
    })).filter((a: Area) => a.pincode.length === 6).sort((a: Area, b: Area) => a.pincode.localeCompare(b.pincode)))
    setLoading(false)
  }
  useEffect(() => { load() }, [])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2500); return () => clearTimeout(t) }, [toast])

  async function quickToggle(s: Service) {
    setToggling(s.id)
    const { error } = await supabase.from('services').update({ is_active: !s.is_active }).eq('id', s.id)
    setToggling(null)
    if (error) { setLoadError(error.message); return }
    setServices(list => list.map(x => x.id === s.id ? { ...x, is_active: !s.is_active } : x))
    setToast(`${s.name} is now ${!s.is_active ? 'shown to customers' : 'hidden'}`)
  }

  const cats = useMemo(() => Array.from(new Set(services.map(s => s.category || 'Uncategorised'))).sort(), [services])
  const q = search.trim().toLowerCase()
  const visible = services.filter(s =>
    (cat === 'all' || (s.category || 'Uncategorised') === cat) &&
    (show === 'all' || (show === 'live' ? s.is_active : show === 'hidden' ? !s.is_active : !(pinCount[s.id] > 0))) &&
    (!q || s.name.toLowerCase().includes(q) || (s.category ?? '').toLowerCase().includes(q)))
  const grouped = cats
    .map(c => ({ cat: c, list: visible.filter(s => (s.category || 'Uncategorised') === c) }))
    .filter(g => g.list.length > 0)

  const liveCount = services.filter(s => s.is_active).length
  const noAreaCount = services.filter(s => !(pinCount[s.id] > 0)).length

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-10 h-10 rounded-full border-4 border-slate-200 animate-spin" style={{ borderTopColor: '#0891B2' }} />
    </div>
  )

  return (
    <div className="min-h-screen px-4 md:px-8 py-7 bg-slate-50">
      {/* header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl bg-white border border-slate-200">🧾</div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 leading-tight">Services</h1>
            <p className="text-xs text-slate-500">
              <b className="text-emerald-600">{liveCount} live</b> · {services.length - liveCount} hidden
              {noAreaCount > 0 && <> · <b className="text-red-600">{noAreaCount} with no area</b></>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a href="/admin-fees" className="px-3 py-2.5 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-600 hover:text-cyan-700 whitespace-nowrap">💳 Fees &amp; extra time ›</a>
          <input type="text" placeholder="Search services…" value={search} onChange={e => setSearch(e.target.value)}
            className="px-4 py-2.5 rounded-xl text-sm text-slate-800 placeholder-slate-400 outline-none bg-white border border-slate-200 w-full md:w-64" />
        </div>
      </div>

      {loadError && <div className="mb-4 rounded-xl px-4 py-3 bg-red-50 border border-red-200 text-sm font-bold text-red-600 flex justify-between">{loadError}<button onClick={() => setLoadError(null)}>✕</button></div>}

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex gap-1.5 overflow-x-auto pb-1 flex-1 min-w-0">
          {['all', ...cats].map(c => {
            const n = c === 'all' ? services.length : services.filter(s => (s.category || 'Uncategorised') === c).length
            const on = cat === c
            return (
              <button key={c} onClick={() => setCat(c)}
                className="flex-shrink-0 px-3.5 py-2 rounded-2xl text-xs font-bold whitespace-nowrap border transition-all"
                style={on ? { background: '#0F172A', color: '#fff', borderColor: '#0F172A' } : { background: '#fff', color: '#475569', borderColor: '#E2E8F0' }}>
                {c === 'all' ? 'All' : `${catIcon(c)} ${c}`} <span className="opacity-60 ml-0.5">{n}</span>
              </button>
            )
          })}
        </div>
        <div className="inline-flex p-1 rounded-xl bg-white border border-slate-200">
          {([['all', 'All'], ['live', 'Live'], ['hidden', 'Hidden'], ['noarea', 'No area']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setShow(k)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold ${show === k ? 'bg-cyan-50 text-cyan-700' : 'text-slate-500'}`}>{l}</button>
          ))}
        </div>
      </div>

      {grouped.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-16 text-center">
          <p className="text-4xl mb-2">🔍</p>
          <p className="text-slate-700 font-bold">No services here</p>
          <button onClick={() => { setSearch(''); setCat('all'); setShow('all') }} className="mt-2 text-sm font-bold text-cyan-600 hover:underline">Show all</button>
        </div>
      ) : grouped.map(g => (
        <section key={g.cat} className="mb-7">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">{catIcon(g.cat)}</span>
            <h2 className="text-[15px] font-black text-slate-800">{g.cat}</h2>
            <span className="text-[11px] font-bold text-slate-400">{g.list.length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
            {g.list.map(s => (
              <ServiceCard key={s.id} s={s} areas={pinCount[s.id] ?? 0} busy={toggling === s.id}
                onOpen={() => setEditing(s)} onToggle={() => quickToggle(s)} />
            ))}
          </div>
        </section>
      ))}

      {editing && (
        <EditPanel service={editing} allAreas={areas}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); setToast(msg); load() }}
          onAreasChanged={(n) => setPinCount(c => ({ ...c, [editing.id]: n }))} />
      )}

      {toast && <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[70] px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold shadow-xl">✓ {toast}</div>}
    </div>
  )
}

function ServiceCard({ s, areas, busy, onOpen, onToggle }: {
  s: Service; areas: number; busy: boolean; onOpen: () => void; onToggle: () => void
}) {
  const bhk = isBhk(s)
  const off = offPct(s.original_price, s.base_price)
  return (
    <div onClick={onOpen}
      className="group relative bg-white rounded-3xl border border-slate-200 p-4 cursor-pointer transition-all hover:border-cyan-300 hover:shadow-md"
      style={{ opacity: s.is_active ? 1 : 0.6 }}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[14px] font-black text-slate-900 leading-snug">{s.name}</p>
        <button onClick={e => { e.stopPropagation(); onToggle() }} disabled={busy}
          title={s.is_active ? 'Shown to customers — click to hide' : 'Hidden — click to show'}
          className="w-10 h-[22px] rounded-full relative shrink-0 transition-colors disabled:opacity-50"
          style={{ background: s.is_active ? '#10B981' : '#CBD5E1' }}>
          <span className="absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-all" style={{ left: s.is_active ? 21 : 3 }} />
        </button>
      </div>

      {bhk ? (
        <div className="grid grid-cols-3 gap-1.5 mt-3">
          {([['1 BHK', s.price_1bhk, s.duration_1bhk], ['2 BHK', s.price_2bhk, s.duration_2bhk], ['3 BHK', s.price_3bhk, s.duration_3bhk]] as const).map(([l, p, d]) => (
            <div key={l} className="rounded-xl bg-slate-50 px-2 py-2 text-center">
              <p className="text-[10px] font-bold text-slate-400">{l}</p>
              <p className="text-[14px] font-black text-cyan-700 leading-tight">{inr(p)}</p>
              <p className="text-[10px] text-slate-400">{mins(d)}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-end gap-2 mt-3">
          <p className="text-2xl font-black text-cyan-700 leading-none">{inr(s.base_price)}</p>
          {s.original_price != null && s.original_price > (s.base_price ?? 0) && (
            <p className="text-sm text-slate-400 line-through leading-none mb-0.5">{inr(s.original_price)}</p>
          )}
          {off > 0 && <span className="text-[10px] font-black px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 mb-0.5">{off}% off</span>}
          <span className="ml-auto text-[12px] font-bold text-slate-500 mb-0.5">⏱ {mins(s.duration_minutes)}</span>
        </div>
      )}

      <div className="flex items-center gap-1.5 mt-3 flex-wrap">
        {areas === 0
          ? <span className="text-[10px] font-black px-2 py-1 rounded-lg bg-red-50 text-red-600">⚠ No area · nobody can book</span>
          : <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-50 text-slate-500">📍 {areas} area{areas === 1 ? '' : 's'}</span>}
        {!s.is_active && <span className="text-[10px] font-black px-2 py-1 rounded-lg bg-slate-100 text-slate-500">Hidden</span>}
        <span className="ml-auto text-[11px] font-bold text-cyan-600 opacity-0 group-hover:opacity-100 transition-opacity">Edit ›</span>
      </div>
    </div>
  )
}

function Num({ value, onChange, prefix, suffix, placeholder, big }: {
  value: string; onChange: (v: string) => void; prefix?: string; suffix?: string; placeholder?: string; big?: boolean
}) {
  return (
    <div className="flex items-center rounded-xl border border-slate-200 bg-white focus-within:border-cyan-400 overflow-hidden">
      {prefix && <span className="pl-3 text-slate-400 font-bold">{prefix}</span>}
      <input type="number" min={0} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className={`w-full px-2.5 py-2.5 outline-none bg-transparent font-black text-slate-900 ${big ? 'text-xl' : 'text-sm'}`} />
      {suffix && <span className="pr-3 text-slate-400 text-xs font-bold">{suffix}</span>}
    </div>
  )
}

function EditPanel({ service, allAreas, onClose, onSaved, onAreasChanged }: {
  service: Service; allAreas: Area[]
  onClose: () => void; onSaved: (msg: string) => void; onAreasChanged: (n: number) => void
}) {
  const supabase = createClient()
  const bhk = isBhk(service)
  const [orig, setOrig] = useState(String(service.original_price ?? ''))
  const [offer, setOffer] = useState(String(service.base_price ?? ''))
  const [dur, setDur] = useState(String(service.duration_minutes ?? ''))
  const [tiers, setTiers] = useState([
    { label: '1 BHK', p: String(service.price_1bhk ?? ''), d: String(service.duration_1bhk ?? '') },
    { label: '2 BHK', p: String(service.price_2bhk ?? ''), d: String(service.duration_2bhk ?? '') },
    { label: '3 BHK', p: String(service.price_3bhk ?? ''), d: String(service.duration_3bhk ?? '') },
  ])
  const [active, setActive] = useState(service.is_active)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const origN = orig === '' ? null : Number(orig)
  const offerN = offer === '' ? null : Number(offer)
  const off = offPct(origN, offerN)
  const origLow = origN != null && offerN != null && origN <= offerN

  async function save() {
    setSaving(true); setError(null)
    try {
      const update: Record<string, any> = { is_active: active }
      if (bhk) {
        const keys = [['price_1bhk', 'duration_1bhk'], ['price_2bhk', 'duration_2bhk'], ['price_3bhk', 'duration_3bhk']]
        tiers.forEach((t, i) => {
          if (t.p !== '') update[keys[i][0]] = Number(t.p)
          if (t.d !== '') update[keys[i][1]] = Number(t.d)
        })
      } else {
        if (offerN == null) { setError('Enter the offer price (what customers pay)'); setSaving(false); return }
        update.original_price = origN
        update.base_price = offerN
        update.duration_minutes = dur === '' ? null : Number(dur)
      }
      const { error: e } = await supabase.from('services').update(update).eq('id', service.id)
      if (e) { setError(e.message); setSaving(false); return }
      onSaved(`${service.name} saved`)
    } catch (e: any) { setError(e?.message ?? 'Could not save'); setSaving(false) }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/30" onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-md bg-slate-50 flex flex-col shadow-2xl">
        <div className="px-5 py-4 bg-white border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-slate-400">{catIcon(service.category || '')} {service.category || 'Uncategorised'}</p>
            <h2 className="text-lg font-black text-slate-900 leading-tight">{service.name}</h2>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200 shrink-0">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* show / hide */}
          <button onClick={() => setActive(a => !a)}
            className="w-full flex items-center justify-between rounded-2xl px-4 py-3 border transition-all"
            style={active ? { background: '#ECFDF5', borderColor: '#A7F3D0' } : { background: '#fff', borderColor: '#E2E8F0' }}>
            <div className="text-left">
              <p className="text-sm font-black" style={{ color: active ? '#047857' : '#334155' }}>{active ? '● Shown to customers' : '○ Hidden from customers'}</p>
              <p className="text-[11px] text-slate-400">Tap to {active ? 'hide' : 'show'} this service in the app</p>
            </div>
            <span className="w-11 h-6 rounded-full relative shrink-0" style={{ background: active ? '#10B981' : '#CBD5E1' }}>
              <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all" style={{ left: active ? 22 : 2 }} />
            </span>
          </button>

          {/* price */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <p className="text-[13px] font-black text-slate-800 mb-3">💰 {bhk ? 'Price by home size' : 'Price & time'}</p>
            {bhk ? (
              <div className="space-y-2">
                <div className="grid grid-cols-[60px_1fr_1fr] gap-2 text-[10px] font-bold text-slate-400 px-1">
                  <span /><span>Price</span><span>Time</span>
                </div>
                {tiers.map((t, i) => (
                  <div key={t.label} className="grid grid-cols-[60px_1fr_1fr] gap-2 items-center">
                    <span className="text-[12px] font-black text-slate-600">{t.label}</span>
                    <Num value={t.p} prefix="₹" onChange={v => setTiers(x => x.map((y, j) => j === i ? { ...y, p: v } : y))} />
                    <Num value={t.d} suffix="min" onChange={v => setTiers(x => x.map((y, j) => j === i ? { ...y, d: v } : y))} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[11px] font-bold text-slate-500">Customer pays</span>
                    <Num value={offer} onChange={setOffer} prefix="₹" big />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-bold text-slate-500">Original (crossed out)</span>
                    <Num value={orig} onChange={setOrig} prefix="₹" placeholder="optional" big />
                  </label>
                </div>
                {origLow && <p className="text-[11px] font-bold text-amber-600">Original price should be higher than what the customer pays, or leave it empty.</p>}
                <div>
                  <span className="text-[11px] font-bold text-slate-500">Time needed</span>
                  <div className="flex gap-1.5 mt-1 mb-2 flex-wrap">
                    {[30, 60, 90, 120, 180, 240].map(m => (
                      <button key={m} onClick={() => setDur(String(m))}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-bold border"
                        style={dur === String(m) ? { background: '#ECFEFF', color: '#0E7490', borderColor: '#67E8F9' } : { background: '#fff', color: '#64748B', borderColor: '#E2E8F0' }}>
                        {mins(m)}
                      </button>
                    ))}
                  </div>
                  <Num value={dur} onChange={setDur} suffix="min" />
                </div>
                {/* customer preview */}
                <div className="rounded-xl bg-slate-50 px-3 py-2.5 flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-400">App shows:</span>
                  <span className="text-[15px] font-black text-slate-900">{offerN != null ? inr(offerN) : '—'}</span>
                  {origN != null && !origLow && <span className="text-[12px] text-slate-400 line-through">{inr(origN)}</span>}
                  {off > 0 && <span className="text-[10px] font-black px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700">{off}% off</span>}
                  <span className="ml-auto text-[11px] text-slate-500">⏱ {mins(dur === '' ? null : Number(dur))}</span>
                </div>
                {(service.price_30min != null || service.price_60min != null || service.price_90min != null) && (
                  <p className="text-[11px] text-slate-400">
                    Quantity prices in the app cart (30 / 60 / 90 min): {inr(service.price_30min)} / {inr(service.price_60min)} / {inr(service.price_90min)} — not editable here.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* areas */}
          <AreasBox serviceId={service.id} allAreas={allAreas} onCount={onAreasChanged} />

          {error && <div className="rounded-xl px-3 py-2.5 bg-red-50 border border-red-200 text-xs font-bold text-red-600">{error}</div>}
        </div>

        <div className="p-4 bg-white border-t border-slate-200 flex gap-2">
          <button onClick={onClose} className="px-4 h-11 rounded-xl text-sm font-bold text-slate-500">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-1 h-11 rounded-xl font-black text-sm text-white disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#0891B2,#4F46E5)' }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </>
  )
}

// Areas save immediately (same as before) — the service is offered ONLY
// in these pincodes; with none it is unavailable to every customer.
function AreasBox({ serviceId, allAreas, onCount }: { serviceId: string; allAreas: Area[]; onCount: (n: number) => void }) {
  const supabase = createClient()
  const [rows, setRows] = useState<{ id: string; pincode: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [input, setInput] = useState('')

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('service_pincodes').select('id, pincode').eq('service_id', serviceId).order('pincode')
    if (error) setErr(error.message)
    setRows(data ?? []); onCount((data ?? []).length); setLoading(false)
  }
  useEffect(() => { load() }, [serviceId])

  const has = (p: string) => rows.some(r => r.pincode === p)

  async function add(pins: string[]) {
    const fresh = pins.filter(p => /^\d{6}$/.test(p) && !has(p))
    if (fresh.length === 0) return
    setBusy('add'); setErr(null)
    const { error } = await supabase.from('service_pincodes').insert(fresh.map(p => ({ service_id: serviceId, pincode: p })))
    setBusy(null)
    if (error) { setErr(error.message); return }
    setInput(''); load()
  }
  async function remove(pin: string) {
    const r = rows.find(x => x.pincode === pin); if (!r) return
    setBusy(pin); setErr(null)
    const { error } = await supabase.from('service_pincodes').delete().eq('id', r.id)
    setBusy(null)
    if (error) { setErr(error.message); return }
    load()
  }

  const extra = rows.filter(r => !allAreas.some(a => a.pincode === r.pincode))
  const missing = allAreas.filter(a => !has(a.pincode)).map(a => a.pincode)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[13px] font-black text-slate-800">📍 Where it&apos;s offered</p>
        {missing.length > 0 && !loading && (
          <button onClick={() => add(missing)} disabled={busy === 'add'}
            className="text-[11px] font-bold text-cyan-700 hover:underline disabled:opacity-50">+ Add all {missing.length} service areas</button>
        )}
      </div>
      <p className="text-[11px] mb-3" style={{ color: rows.length === 0 ? '#DC2626' : '#64748B' }}>
        {loading ? 'Loading…' : rows.length === 0
          ? '⚠ No area selected — nobody can book this service.'
          : `Customers in ${rows.length} pincode${rows.length === 1 ? '' : 's'} can book it. Tap to switch an area on or off — saved instantly.`}
      </p>
      {!loading && (
        <div className="flex flex-wrap gap-1.5">
          {allAreas.map(a => {
            const on = has(a.pincode)
            return (
              <button key={a.pincode} disabled={busy === a.pincode || busy === 'add'}
                onClick={() => on ? remove(a.pincode) : add([a.pincode])}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-all disabled:opacity-50"
                style={on ? { background: '#ECFEFF', color: '#0E7490', borderColor: '#67E8F9' } : { background: '#fff', color: '#94A3B8', borderColor: '#E2E8F0' }}>
                {on ? '✓ ' : '+ '}{a.pincode}{a.name ? ` · ${a.name}` : ''}
              </button>
            )
          })}
          {extra.map(r => (
            <button key={r.id} disabled={busy === r.pincode} onClick={() => remove(r.pincode)}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border disabled:opacity-50"
              style={{ background: '#ECFEFF', color: '#0E7490', borderColor: '#67E8F9' }}>✓ {r.pincode}</button>
          ))}
        </div>
      )}
      <div className="flex gap-2 mt-3">
        <input value={input} onChange={e => setInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={e => { if (e.key === 'Enter') add([input]) }}
          placeholder="Other pincode" inputMode="numeric"
          className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono outline-none focus:border-cyan-400" />
        <button onClick={() => add([input])} disabled={input.length !== 6 || busy === 'add'}
          className="px-3 py-2 rounded-xl text-xs font-black text-white disabled:opacity-40" style={{ background: '#0891B2' }}>Add</button>
      </div>
      {err && <p className="text-[11px] font-bold text-red-600 mt-2">{err}</p>}
    </div>
  )
}