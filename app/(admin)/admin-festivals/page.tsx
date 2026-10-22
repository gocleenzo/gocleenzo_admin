'use client'
// app/(admin)/admin-festivals/page.tsx
// 🪔 Festival themes — schedule Diwali, Christmas, Holi… and the customer
// app changes its look by itself on those dates. Owner edits; assistants view.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Colors = { main: string; header: string; accent: string; bg: string; card: string; text: string }
type Effects = { falling: boolean; lights: boolean; fireworks: boolean; shimmer: boolean }
type Banner = {
  id?: string; theme_id: string; image_url: string; title: string | null; subtitle: string | null
  promo_code: string | null; service_id: string | null; sort_order: number; is_enabled: boolean
}
type Theme = {
  id?: string; name: string; start_date: string | null; end_date: string | null; priority: number
  is_enabled: boolean; pack: 'none' | 'diwali'; colors: Colors; effects: Effects
  header_image_url: string | null; splash_image_url: string | null; particle_image_url: string | null
  lottie_header_url: string | null; lottie_celebrate_url: string | null
  greeting: string | null; subline: string | null; splash_text: string | null; confirm_text: string | null
  featured_title: string | null; featured_service_ids: string[]; preview_phones: string[]
  push_enabled: boolean; push_title: string | null; push_body: string | null; push_sent_at?: string | null
  banners?: Banner[]
}
type Service = { id: string; name: string }

const NORMAL: Colors = { main: '#00B1FC', header: '#00B1FC', accent: '#0D2D5E', bg: '#F0FDFF', card: '#FFFFFF', text: '#0F172A' }
const COLOR_FIELDS: { key: keyof Colors; label: string; help: string }[] = [
  { key: 'main', label: 'Main', help: 'Buttons, selected items, icons' },
  { key: 'header', label: 'Header', help: 'Top of the home screen, offer cards' },
  { key: 'accent', label: 'Accent', help: 'Greeting, lights, highlights' },
  { key: 'bg', label: 'Background', help: 'Behind everything' },
  { key: 'card', label: 'Cards', help: 'Service and booking cards' },
  { key: 'text', label: 'Text', help: 'Main text colour' },
]
const EFFECTS: { key: keyof Effects; label: string; help: string }[] = [
  { key: 'falling', label: 'Falling pictures', help: 'Your small picture drifts down the home screen for a few seconds' },
  { key: 'lights', label: 'Light string', help: 'Twinkling lights across the top, in the accent colour' },
  { key: 'fireworks', label: 'Fireworks on booking', help: 'Celebration when a booking is confirmed' },
  { key: 'shimmer', label: 'Shine on offers', help: 'A soft shine moves across the offer banners' },
]
const UPLOADS: { key: keyof Theme; label: string; help: string; accept: string; kind: 'image' | 'lottie' }[] = [
  { key: 'header_image_url', label: 'Header photo', help: 'Wide photo behind the greeting card on the home screen. About 1200×400, under 1 MB.', accept: 'image/png,image/jpeg,image/webp', kind: 'image' },
  { key: 'particle_image_url', label: 'Falling picture', help: 'Small PNG with see-through background: petal, snowflake, kite. About 96×96.', accept: 'image/png,image/webp,image/gif', kind: 'image' },
  { key: 'splash_image_url', label: 'Splash picture', help: 'Shown on the opening screen. Square PNG works best.', accept: 'image/png,image/jpeg,image/webp', kind: 'image' },
  { key: 'lottie_header_url', label: 'Header animation (Lottie)', help: 'Optional. A .json animation from LottieFiles.com, e.g. a flickering diya.', accept: '.json,application/json', kind: 'lottie' },
  { key: 'lottie_celebrate_url', label: 'Booking celebration (Lottie)', help: 'Optional. Plays when a booking is confirmed, e.g. fireworks.', accept: '.json,application/json', kind: 'lottie' },
]

const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const fmtD = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const addYear = (d: string | null) => d ? `${Number(d.slice(0, 4)) + 1}${d.slice(4)}` : null

function lum(hex: string) {
  const h = hex.replace('#', '')
  const c = [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
function contrast(a: string, b: string) {
  const x = lum(a), y = lum(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
// Same rule the app uses: dark text on light colours, white on dark ones
const onColor = (hex: string) => lum(hex) > 0.3 ? '#0D2D5E' : '#FFFFFF'

function status(t: Theme, today: string): { label: string; bg: string; fg: string } {
  if (!t.is_enabled) return t.preview_phones.length ? { label: 'Preview only', bg: '#EDE9FE', fg: '#6D28D9' } : { label: 'Off', bg: '#F1F5F9', fg: '#64748B' }
  if (!t.start_date || !t.end_date) return { label: 'No dates', bg: '#FEF3C7', fg: '#B45309' }
  if (today < t.start_date) return { label: 'Scheduled', bg: '#E0F2FE', fg: '#0369A1' }
  if (today > t.end_date) return { label: 'Ended', bg: '#F1F5F9', fg: '#94A3B8' }
  return { label: 'Live now', bg: '#DCFCE7', fg: '#15803D' }
}

function blankTheme(): Theme {
  return {
    name: '', start_date: null, end_date: null, priority: 5, is_enabled: false, pack: 'none',
    colors: { ...NORMAL, header: '#0D2D5E', accent: '#F2B33D', bg: '#FFFFFF' },
    effects: { falling: true, lights: true, fireworks: true, shimmer: true },
    header_image_url: null, splash_image_url: null, particle_image_url: null, lottie_header_url: null, lottie_celebrate_url: null,
    greeting: 'Happy festival, {name}', subline: '', splash_text: '', confirm_text: '',
    featured_title: '', featured_service_ids: [], preview_phones: [],
    push_enabled: false, push_title: '', push_body: '', banners: [],
  }
}

async function api(body: any) {
  const res = await fetch('/api/settings/festivals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error || 'Something went wrong')
  return j
}
async function upload(file: File): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/settings/festivals', { method: 'POST', body: fd })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error || 'Upload failed')
  return j.url
}

export default function FestivalThemesPage() {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [role, setRole] = useState('')
  const [themes, setThemes] = useState<Theme[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [selId, setSelId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Theme | null>(null)
  const [saving, setSaving] = useState(false)
  const [busyUpload, setBusyUpload] = useState<string | null>(null)
  const [testPhone, setTestPhone] = useState('')
  const isOwner = role === 'owner'
  const today = todayIST()

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600) }

  const load = useCallback(async (keepSel?: string | null) => {
    setErr(null)
    try {
      const res = await fetch('/api/settings/festivals', { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Could not load festival themes')
      setRole(j.role || '')
      setServices(j.services || [])
      const list: Theme[] = (j.themes || []).map((t: any) => ({
        ...blankTheme(), ...t,
        colors: { ...NORMAL, ...(t.colors || {}) },
        effects: { falling: false, lights: false, fireworks: false, shimmer: false, ...(t.effects || {}) },
        featured_service_ids: t.featured_service_ids || [], preview_phones: t.preview_phones || [], banners: t.banners || [],
      }))
      setThemes(list)
      const want = keepSel ?? null
      const pick = list.find(t => t.id === want) || list.find(t => status(t, todayIST()).label === 'Live now') || list[0] || null
      setSelId(pick?.id ?? null)
      setDraft(pick ? JSON.parse(JSON.stringify(pick)) : null)
    } catch (e: any) { setErr(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const saved = useMemo(() => themes.find(t => t.id === selId) || null, [themes, selId])
  const dirty = useMemo(() => {
    if (!draft) return false
    if (!draft.id) return true
    const strip = (t: Theme) => JSON.stringify({ ...t, banners: undefined, push_sent_at: undefined, updated_at: undefined, created_at: undefined })
    return !saved || strip(draft) !== strip(saved)
  }, [draft, saved])

  const set = <K extends keyof Theme>(k: K, v: Theme[K]) => setDraft(d => d ? { ...d, [k]: v } : d)
  const setColor = (k: keyof Colors, v: string) => setDraft(d => d ? { ...d, colors: { ...d.colors, [k]: v.toUpperCase() } } : d)
  const setEffect = (k: keyof Effects) => setDraft(d => d ? { ...d, effects: { ...d.effects, [k]: !d.effects[k] } } : d)

  const choose = (t: Theme | null) => {
    if (dirty && !confirm('You have unsaved changes. Leave them?')) return
    setSelId(t?.id ?? null)
    setDraft(t ? JSON.parse(JSON.stringify(t)) : blankTheme())
  }

  const save = async () => {
    if (!draft) return
    setSaving(true); setErr(null)
    try {
      const j = await api({ action: 'save_theme', theme: { ...draft, banners: undefined } })
      flash(draft.id ? 'Saved' : 'Festival created')
      await load(j.theme.id)
    } catch (e: any) { setErr(e.message) } finally { setSaving(false) }
  }

  const remove = async () => {
    if (!draft?.id) { setDraft(null); return }
    if (!confirm(`Delete "${draft.name}" and its banners? This cannot be undone.`)) return
    try { await api({ action: 'delete_theme', id: draft.id }); flash('Deleted'); await load(null) } catch (e: any) { setErr(e.message) }
  }

  const copyNextYear = () => {
    if (!saved) return
    if (dirty && !confirm('You have unsaved changes. Leave them?')) return
    const c: Theme = JSON.parse(JSON.stringify(saved))
    delete c.id; c.banners = []; c.push_sent_at = null
    c.is_enabled = false
    c.start_date = addYear(c.start_date); c.end_date = addYear(c.end_date)
    setSelId(null); setDraft(c)
    flash('Copied for next year — check the dates, then Save')
  }

  const onUpload = async (key: keyof Theme, file: File | undefined) => {
    if (!file) return
    setBusyUpload(String(key)); setErr(null)
    try { const url = await upload(file); set(key, url as any) } catch (e: any) { setErr(e.message) } finally { setBusyUpload(null) }
  }

  const sendTest = async () => {
    if (!draft) return
    try {
      const j = await api({ action: 'test_push', phone: testPhone, title: draft.push_title, body: draft.push_body })
      flash(j.ok ? 'Test push sent' : 'Could not send — does this phone have the app with notifications on?')
    } catch (e: any) { setErr(e.message) }
  }

  const textRatio = draft ? contrast(draft.colors.text, draft.colors.bg) : 21
  const cardRatio = draft ? contrast(draft.colors.text, draft.colors.card) : 21
  const colorsBad = textRatio < 4.5 || cardRatio < 4.5
  const datesBad = !!(draft?.start_date && draft?.end_date && draft.end_date < draft.start_date)

  if (loading) return <div className="p-8 text-slate-500 font-bold">Loading festival themes…</div>

  return (
    <div className="p-4 md:p-6 max-w-[1500px] mx-auto">
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div className="flex-1 min-w-[280px]">
          <h1 className="text-2xl font-black text-slate-900">🪔 Festival themes</h1>
          <p className="text-sm text-slate-500">Schedule a festival and the customer app changes its look by itself on those dates. On days with no festival, customers see the normal Cleenzo look. Changes reach phones the next time the app opens.</p>
        </div>
        {isOwner && <button onClick={() => choose(null)} className="px-4 py-2.5 rounded-xl text-white font-black text-sm" style={{ background: '#00B1FC', color: '#0D2D5E' }}>+ New festival</button>}
      </div>

      {err && <div className="mb-4 rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-sm font-bold text-red-700 flex justify-between gap-3"><span>{err}</span><button onClick={() => setErr(null)}>✕</button></div>}
      {!isOwner && <div className="mb-4 rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-600">View only — only the owner can change festival themes.</div>}

      <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_330px] lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* ── Calendar ── */}
        <aside className="bg-white rounded-3xl border border-slate-200 p-3 h-fit">
          <h2 className="text-sm font-black text-slate-900 px-2 pt-1 pb-2">Calendar</h2>
          {themes.length === 0 && <p className="text-xs text-slate-400 px-2 pb-3">No festivals yet.</p>}
          <div className="space-y-1">
            {themes.map(t => {
              const st = status(t, today), on = t.id === selId
              return (
                <button key={t.id} onClick={() => choose(t)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-left border ${on ? 'bg-amber-50 border-amber-300' : 'border-transparent hover:bg-slate-50'}`}>
                  <span className="w-4 h-4 rounded-md shrink-0" style={{ background: t.colors.header, boxShadow: `5px 5px 0 -1px ${t.colors.main}` }} />
                  <span className="flex-1 min-w-0">
                    <span className="block font-black text-slate-900 text-sm truncate">{t.name}</span>
                    <span className="block text-[11px] text-slate-500">{t.start_date && t.end_date ? `${fmtD(t.start_date)} – ${fmtD(t.end_date)}` : 'No dates yet'}</span>
                  </span>
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
                </button>
              )
            })}
          </div>
          {isOwner && saved && <button onClick={copyNextYear} className="mt-3 w-full py-2.5 rounded-xl border border-dashed border-slate-300 text-xs font-black text-slate-500 hover:bg-slate-50">Copy “{saved.name}” for next year</button>}
          <p className="text-[11px] text-slate-400 px-2 mt-3">If two festivals overlap, the one with the higher priority is shown.</p>
        </aside>

        {/* ── Editor ── */}
        {!draft ? (
          <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center text-slate-500">
            <p className="text-3xl mb-2">🪔</p><p className="font-bold">Pick a festival on the left, or create a new one.</p>
          </div>
        ) : (
          <main className="space-y-5 min-w-0">
            <fieldset disabled={!isOwner} className="space-y-5 min-w-0">
              <section className="bg-white rounded-3xl border border-slate-200 p-5">
                <div className="flex flex-wrap items-center gap-4">
                  <button type="button" onClick={() => set('is_enabled', !draft.is_enabled)} role="switch" aria-checked={draft.is_enabled}
                    className="w-14 h-8 rounded-full relative shrink-0 transition-colors disabled:opacity-60" style={{ background: draft.is_enabled ? '#16A34A' : '#CBD5E1' }}>
                    <span className="absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all" style={{ left: draft.is_enabled ? 30 : 4 }} />
                  </button>
                  <div className="flex-1 min-w-[200px]">
                    <p className="font-black text-slate-900">{draft.is_enabled ? 'Switched on' : 'Switched off'}</p>
                    <p className="text-xs text-slate-500">{draft.is_enabled ? 'Customers see this theme on the dates below.' : 'Customers do not see it. Numbers in “Preview phones” still can.'}</p>
                  </div>
                  {draft.push_sent_at && <span className="text-[11px] font-bold text-slate-500">Push sent {new Date(draft.push_sent_at).toLocaleString('en-IN')}</span>}
                </div>
                <div className="grid gap-3 mt-5 md:grid-cols-[2fr_1fr_1fr_110px]">
                  <Field label="Festival name"><input value={draft.name} onChange={e => set('name', e.target.value)} maxLength={40} placeholder="Diwali" className="inp" /></Field>
                  <Field label="Starts"><input type="date" value={draft.start_date ?? ''} onChange={e => set('start_date', e.target.value || null)} className="inp" /></Field>
                  <Field label="Ends (last day)"><input type="date" value={draft.end_date ?? ''} onChange={e => set('end_date', e.target.value || null)} className="inp" /></Field>
                  <Field label="Priority"><input type="number" min={0} max={100} value={draft.priority} onChange={e => set('priority', Number(e.target.value))} className="inp" /></Field>
                </div>
                {datesBad && <p className="text-xs font-bold text-red-600 mt-2">The end date is before the start date.</p>}
                <div className="mt-4">
                  <Field label="Built-in festive art">
                    <select value={draft.pack} onChange={e => set('pack', e.target.value as Theme['pack'])} className="inp">
                      <option value="diwali">Diwali — diya light string, rangoli, glowing diyas</option>
                      <option value="none">None — use only my uploaded photos and animations</option>
                    </select>
                  </Field>
                </div>
              </section>

              <section className="bg-white rounded-3xl border border-slate-200 p-5">
                <h2 className="font-black text-slate-900">🎨 Colours <span className="text-xs font-bold text-slate-400">· the whole app takes these</span></h2>
                <div className="grid gap-3 mt-3 grid-cols-2 md:grid-cols-3 2xl:grid-cols-6">
                  {COLOR_FIELDS.map(f => (
                    <label key={f.key} className="rounded-2xl border border-slate-200 p-2.5 block">
                      <span className="flex items-center gap-2">
                        <input type="color" value={draft.colors[f.key]} onChange={e => setColor(f.key, e.target.value)} className="w-10 h-10 rounded-lg border border-slate-200 bg-white cursor-pointer" />
                        <span className="min-w-0"><span className="block text-sm font-black text-slate-800">{f.label}</span><span className="block text-[11px] font-mono text-slate-500">{draft.colors[f.key]}</span></span>
                      </span>
                      <span className="block text-[11px] text-slate-400 mt-1.5 leading-tight">{f.help}</span>
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button type="button" onClick={() => set('colors', { ...draft.colors, main: '#00B1FC', text: '#0F172A', card: '#FFFFFF' })} className="text-xs font-black px-3 py-1.5 rounded-lg border border-slate-200">Use Cleenzo cyan for buttons</button>
                </div>
                {colorsBad
                  ? <p role="alert" className="mt-3 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm font-bold text-red-700">Text is hard to read (background {textRatio.toFixed(1)}:1, cards {cardRatio.toFixed(1)}:1). Use a darker text colour or a lighter background — at least 4.5:1. Saving is blocked until then.</p>
                  : <p className="mt-3 text-xs font-bold text-green-700">Readable ✓ text contrast {Math.min(textRatio, cardRatio).toFixed(1)}:1. Button and header text switch between white and dark navy automatically.</p>}
              </section>

              <section className="bg-white rounded-3xl border border-slate-200 p-5">
                <h2 className="font-black text-slate-900">🖼️ Photos and animations</h2>
                <p className="text-xs text-slate-500 mt-0.5">For a real, premium look use photos (e.g. from Unsplash or Pexels, free for business use) and Lottie animations from LottieFiles.com (free ones allow business use). Max 4 MB each.</p>
                <div className="grid gap-3 mt-4 md:grid-cols-2">
                  {UPLOADS.map(u => {
                    const url = draft[u.key] as string | null
                    return (
                      <div key={String(u.key)} className="rounded-2xl border border-slate-200 p-3 flex gap-3">
                        <div className="w-20 h-20 rounded-xl shrink-0 overflow-hidden grid place-items-center" style={{ background: u.kind === 'image' ? 'repeating-conic-gradient(#F1F5F9 0 25%, #fff 0 50%) 0 0/16px 16px' : '#F8FAFC' }}>
                          {url ? (u.kind === 'image' ? <img src={url} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] font-black text-slate-500 text-center px-1">Lottie ✓</span>) : <span className="text-[10px] text-slate-400">none</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-black text-slate-800">{u.label}</p>
                          <p className="text-[11px] text-slate-500 leading-snug">{u.help}</p>
                          <div className="flex flex-wrap gap-2 mt-2">
                            <label className={`text-xs font-black px-3 py-1.5 rounded-lg border border-slate-300 cursor-pointer ${!isOwner ? 'opacity-50 pointer-events-none' : ''}`}>
                              {busyUpload === u.key ? 'Uploading…' : url ? 'Replace' : 'Upload'}
                              <input type="file" accept={u.accept} className="hidden" onChange={e => { onUpload(u.key, e.target.files?.[0]); e.currentTarget.value = '' }} />
                            </label>
                            {url && <button type="button" onClick={() => set(u.key, null as any)} className="text-xs font-black px-3 py-1.5 rounded-lg text-red-600 hover:bg-red-50">Remove</button>}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <h3 className="font-black text-slate-800 text-sm mt-5 mb-2">Animations</h3>
                <div className="grid gap-2 md:grid-cols-2">
                  {EFFECTS.map(f => (
                    <label key={f.key} className="flex items-start gap-3 rounded-2xl border border-slate-200 p-3 cursor-pointer">
                      <input type="checkbox" checked={draft.effects[f.key]} onChange={() => setEffect(f.key)} className="mt-1 w-4 h-4 accent-cyan-500" />
                      <span><span className="block text-sm font-black text-slate-800">{f.label}</span><span className="block text-[11px] text-slate-500">{f.help}</span></span>
                    </label>
                  ))}
                </div>
                {draft.effects.falling && !draft.particle_image_url && draft.pack !== 'diwali' && <p className="text-xs font-bold text-amber-700 mt-2">Upload a “Falling picture” to use falling pictures.</p>}
              </section>

              <section className="bg-white rounded-3xl border border-slate-200 p-5">
                <h2 className="font-black text-slate-900">✍️ Words</h2>
                <p className="text-xs text-slate-500">Write {'{name}'} where the customer's first name should go.</p>
                <div className="grid gap-3 mt-3 md:grid-cols-2">
                  <Field label="Home greeting"><input value={draft.greeting ?? ''} onChange={e => set('greeting', e.target.value)} maxLength={60} className="inp" placeholder="Shubh Deepavali, {name}" /></Field>
                  <Field label="Line under the greeting"><input value={draft.subline ?? ''} onChange={e => set('subline', e.target.value)} maxLength={90} className="inp" placeholder="Make your home shine for Lakshmi Puja" /></Field>
                  <Field label="Splash screen message"><input value={draft.splash_text ?? ''} onChange={e => set('splash_text', e.target.value)} maxLength={60} className="inp" placeholder="Shubh Deepavali" /></Field>
                  <Field label="Booking confirmed message"><input value={draft.confirm_text ?? ''} onChange={e => set('confirm_text', e.target.value)} maxLength={120} className="inp" placeholder="Your home will be shining before Lakshmi Puja." /></Field>
                </div>
              </section>

              <section className="bg-white rounded-3xl border border-slate-200 p-5">
                <h2 className="font-black text-slate-900">⭐ Festive picks on the home screen</h2>
                <p className="text-xs text-slate-500">A row of services you want to push during the festival. Leave empty to hide the row.</p>
                <div className="mt-3 max-w-md"><Field label="Row title"><input value={draft.featured_title ?? ''} onChange={e => set('featured_title', e.target.value)} maxLength={40} className="inp" placeholder="Diwali Safai picks" /></Field></div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {services.map(s => {
                    const on = draft.featured_service_ids.includes(s.id)
                    return (
                      <button type="button" key={s.id}
                        onClick={() => set('featured_service_ids', on ? draft.featured_service_ids.filter(x => x !== s.id) : [...draft.featured_service_ids, s.id].slice(0, 12))}
                        className={`text-xs font-black px-3 py-1.5 rounded-full border ${on ? 'bg-cyan-50 border-cyan-400 text-cyan-800' : 'border-slate-200 text-slate-600'}`}>{on ? '✓ ' : ''}{s.name}</button>
                    )
                  })}
                </div>
              </section>

              <section className="bg-white rounded-3xl border border-slate-200 p-5">
                <h2 className="font-black text-slate-900">🔔 Push greeting on day 1</h2>
                <p className="text-xs text-slate-500">Sent once at 9:00 AM on the start date to every customer with notifications on — only if the festival is switched on.</p>
                <label className="flex items-center gap-3 mt-3 cursor-pointer">
                  <input type="checkbox" checked={draft.push_enabled} onChange={() => set('push_enabled', !draft.push_enabled)} className="w-4 h-4 accent-cyan-500" />
                  <span className="text-sm font-black text-slate-800">Send the push greeting</span>
                </label>
                <div className="grid gap-3 mt-3 md:grid-cols-[1fr_2fr]">
                  <Field label="Title"><input value={draft.push_title ?? ''} onChange={e => set('push_title', e.target.value)} maxLength={60} className="inp" placeholder="Shubh Deepavali from Cleenzo" /></Field>
                  <Field label={`Message (${(draft.push_body ?? '').length}/200)`}><input value={draft.push_body ?? ''} onChange={e => set('push_body', e.target.value)} maxLength={200} className="inp" /></Field>
                </div>
                <div className="flex flex-wrap items-end gap-2 mt-3">
                  <Field label="Send a test to"><input value={testPhone} onChange={e => setTestPhone(e.target.value)} inputMode="tel" placeholder="98765 43210" className="inp w-44" /></Field>
                  <button type="button" onClick={sendTest} disabled={!draft.push_body} className="px-4 py-2.5 rounded-xl border border-slate-300 font-black text-sm disabled:opacity-50">Send test</button>
                </div>
              </section>

              <section className="bg-white rounded-3xl border border-slate-200 p-5">
                <h2 className="font-black text-slate-900">📱 Preview on your phone before it goes live</h2>
                <p className="text-xs text-slate-500">These numbers see this theme in the app even while it is switched off or before its start date. Close and reopen the app to see changes.</p>
                <div className="mt-3 max-w-xl">
                  <input key={draft.id ?? 'new'} defaultValue={draft.preview_phones.join(', ')}
                    onChange={e => set('preview_phones', e.target.value.split(',').map(x => x.replace(/\D/g, '').slice(-10)).filter(x => x.length === 10))}
                    className="inp" placeholder="9702728298, 9820011111" />
                  <p className="text-[11px] text-slate-400 mt-1">Separate numbers with a comma. {draft.preview_phones.length} valid number{draft.preview_phones.length === 1 ? '' : 's'}.</p>
                </div>
              </section>
            </fieldset>

            {draft.id && <BannersEditor theme={draft} services={services} isOwner={isOwner} onChanged={() => load(draft.id)} onError={setErr} />}
            {!draft.id && <p className="text-xs font-bold text-slate-500 px-2">Save the festival first, then you can add offer banners.</p>}

            {isOwner && (
              <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-2xl bg-slate-900 text-white px-4 py-3 shadow-xl">
                <span className="text-sm font-bold flex-1 min-w-[160px]">{dirty ? 'You have unsaved changes' : 'All changes saved'}</span>
                {draft.id && <button onClick={remove} className="px-3 py-2 rounded-xl text-sm font-black text-red-300 hover:bg-white/10">Delete</button>}
                {dirty && draft.id && <button onClick={() => setDraft(saved ? JSON.parse(JSON.stringify(saved)) : null)} className="px-3 py-2 rounded-xl text-sm font-black hover:bg-white/10">Undo</button>}
                <button onClick={save} disabled={saving || !dirty || colorsBad || datesBad || !draft.name.trim()}
                  className="px-5 py-2.5 rounded-xl font-black text-sm disabled:opacity-40" style={{ background: '#00B1FC', color: '#0D2D5E' }}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            )}
          </main>
        )}

        {/* ── Live preview ── */}
        {draft && <div className="lg:col-span-2 xl:col-span-1"><PhonePreview t={draft} services={services} /></div>}
      </div>

      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-slate-900 text-white text-sm font-bold px-4 py-2.5 shadow-xl">{toast}</div>}
      <style>{`
        .inp { width: 100%; height: 42px; padding: 0 12px; border-radius: 12px; border: 1px solid #E2E8F0; background: #fff; font-weight: 600; font-size: 14px; color: #0F172A; outline: none; }
        .inp:focus { border-color: #00B1FC; box-shadow: 0 0 0 3px rgba(0,177,252,.18); }
        .inp:disabled { background: #F8FAFC; color: #64748B; }
        @keyframes fv-tw { 0%,100% { opacity: .35 } 50% { opacity: 1 } }
        @keyframes fv-fall { 0% { transform: translateY(-20px) rotate(0); opacity: 0 } 10% { opacity: 1 } 100% { transform: translateY(560px) rotate(300deg); opacity: 0 } }
        @keyframes fv-shine { 0% { transform: translateX(-120%) skewX(-18deg) } 60%,100% { transform: translateX(320%) skewX(-18deg) } }
        @media (prefers-reduced-motion: reduce) { .fv-anim { animation: none !important } }
      `}</style>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-[11px] font-black text-slate-500 mb-1">{label}</span>{children}</label>
}

function BannersEditor({ theme, services, isOwner, onChanged, onError }: {
  theme: Theme; services: Service[]; isOwner: boolean; onChanged: () => void; onError: (m: string) => void
}) {
  const [edit, setEdit] = useState<Banner | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const list = theme.banners ?? []

  const saveB = async (b: Banner) => {
    setBusy(true)
    try { await api({ action: 'save_banner', banner: b }); setEdit(null); onChanged() } catch (e: any) { onError(e.message) } finally { setBusy(false) }
  }
  const delB = async (b: Banner) => {
    if (!confirm('Delete this banner?')) return
    try { await api({ action: 'delete_banner', id: b.id }); onChanged() } catch (e: any) { onError(e.message) }
  }
  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= list.length) return
    const a = list[i], b = list[j]
    try {
      await api({ action: 'save_banner', banner: { ...a, sort_order: j } })
      await api({ action: 'save_banner', banner: { ...b, sort_order: i } })
      onChanged()
    } catch (e: any) { onError(e.message) }
  }

  return (
    <section className="bg-white rounded-3xl border border-slate-200 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <h2 className="font-black text-slate-900">🏷️ Offer banners</h2>
          <p className="text-xs text-slate-500">Replace the big sliding banners at the top of the home screen during this festival, in this order. Use a tall photo, about 1080×1000 — keep words in the lower half (the top is covered by the location bar). Codes come from your Coupons list.</p>
        </div>
        {isOwner && <button onClick={() => setEdit({ theme_id: theme.id!, image_url: '', title: '', subtitle: '', promo_code: '', service_id: null, sort_order: list.length, is_enabled: true })}
          className="px-4 py-2 rounded-xl font-black text-sm" style={{ background: '#00B1FC', color: '#0D2D5E' }}>+ Add banner</button>}
      </div>
      {list.length === 0 && !edit && <p className="text-sm text-slate-400 mt-4">No banners yet. Without banners the home screen keeps its usual banners.</p>}
      <div className="space-y-2 mt-4">
        {list.map((b, i) => (
          <div key={b.id} className={`flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 p-2 ${b.is_enabled ? '' : 'opacity-50'}`}>
            <img src={b.image_url} alt="" className="w-28 h-14 rounded-xl object-cover bg-slate-100" />
            <div className="flex-1 min-w-[140px]">
              <p className="text-sm font-black text-slate-800 truncate">{b.title || 'Picture only'}</p>
              <p className="text-[11px] text-slate-500 truncate">{[b.promo_code && `Code ${b.promo_code}`, services.find(s => s.id === b.service_id)?.name || 'Opens Offers'].filter(Boolean).join(' · ')}</p>
            </div>
            {isOwner && <>
              <button onClick={() => move(i, -1)} disabled={i === 0} className="w-8 h-8 rounded-lg hover:bg-slate-100 disabled:opacity-30" aria-label="Move up">↑</button>
              <button onClick={() => move(i, 1)} disabled={i === list.length - 1} className="w-8 h-8 rounded-lg hover:bg-slate-100 disabled:opacity-30" aria-label="Move down">↓</button>
              <button onClick={() => saveB({ ...b, is_enabled: !b.is_enabled })} className="text-xs font-black px-2.5 py-1.5 rounded-lg border border-slate-200">{b.is_enabled ? 'Hide' : 'Show'}</button>
              <button onClick={() => setEdit({ ...b })} className="text-xs font-black px-2.5 py-1.5 rounded-lg border border-slate-200">Edit</button>
              <button onClick={() => delB(b)} className="text-xs font-black px-2.5 py-1.5 rounded-lg text-red-600 hover:bg-red-50">Delete</button>
            </>}
          </div>
        ))}
      </div>

      {edit && (
        <div className="mt-4 rounded-2xl border-2 border-cyan-200 bg-cyan-50/40 p-4 space-y-3">
          <div className="flex gap-3 items-start">
            <div className="w-40 h-20 rounded-xl overflow-hidden bg-slate-100 grid place-items-center shrink-0">
              {edit.image_url ? <img src={edit.image_url} alt="" className="w-full h-full object-cover" /> : <span className="text-[11px] text-slate-400">No picture</span>}
            </div>
            <div>
              <button type="button" onClick={() => fileRef.current?.click()} className="text-xs font-black px-3 py-2 rounded-lg border border-slate-300 bg-white">{busy ? 'Uploading…' : edit.image_url ? 'Replace picture' : 'Upload picture'}</button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                onChange={async e => {
                  const f = e.target.files?.[0]; e.currentTarget.value = ''
                  if (!f) return
                  setBusy(true)
                  try { const url = await upload(f); setEdit(x => x ? { ...x, image_url: url } : x) } catch (er: any) { onError(er.message) } finally { setBusy(false) }
                }} />
              <p className="text-[11px] text-slate-500 mt-1">If your picture already has the offer written on it, leave the title empty.</p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Title (optional)"><input value={edit.title ?? ''} onChange={e => setEdit({ ...edit, title: e.target.value })} maxLength={60} className="inp" placeholder="20% off Diwali deep cleaning" /></Field>
            <Field label="Small line (optional)"><input value={edit.subtitle ?? ''} onChange={e => setEdit({ ...edit, subtitle: e.target.value })} maxLength={90} className="inp" placeholder="Up to ₹200 off · till 9 Nov" /></Field>
            <Field label="Coupon code to show (optional)"><input value={edit.promo_code ?? ''} onChange={e => setEdit({ ...edit, promo_code: e.target.value.toUpperCase() })} maxLength={30} className="inp" placeholder="DIWALI20" /></Field>
            <Field label="Tapping the banner opens">
              <select value={edit.service_id ?? ''} onChange={e => setEdit({ ...edit, service_id: e.target.value || null })} className="inp">
                <option value="">Offers screen</option>
                {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setEdit(null)} className="px-4 py-2 rounded-xl text-sm font-black hover:bg-white">Cancel</button>
            <button onClick={() => saveB(edit)} disabled={busy || !edit.image_url} className="px-4 py-2 rounded-xl text-sm font-black disabled:opacity-40" style={{ background: '#00B1FC', color: '#0D2D5E' }}>Save banner</button>
          </div>
        </div>
      )}
    </section>
  )
}

function PhonePreview({ t, services }: { t: Theme; services: Service[] }) {
  const c = t.colors
  const onMain = onColor(c.main), onHeader = onColor(c.header)
  const greet = (t.greeting || 'Hi {name}').replace('{name}', 'Priya')
  const banners = (t.banners ?? []).filter(b => b.is_enabled)
  const picks = t.featured_service_ids.map(id => services.find(s => s.id === id)).filter(Boolean) as Service[]
  return (
    <div className="xl:sticky xl:top-4">
      <p className="text-[11px] font-black tracking-widest text-slate-400 text-center mb-2">LIVE PREVIEW</p>
      <div className="mx-auto w-[300px] rounded-[38px] bg-black p-2.5 shadow-2xl">
        <div className="relative h-[600px] overflow-hidden rounded-[30px]" style={{ background: c.bg, color: c.text }}>
          {/* Top banner — full width, like the real home screen */}
          <div className="relative h-[230px] overflow-hidden rounded-b-[24px]" style={{ background: c.header, color: onHeader }}>
            {banners[0] && <img src={banners[0].image_url} alt="" className="absolute inset-0 w-full h-full object-cover" />}
            <div className="absolute top-0 inset-x-0 px-3 pt-3 flex items-center gap-2 text-[11px] font-bold" style={{ color: banners[0] ? '#fff' : onHeader }}>
              <span className="px-2 py-1 rounded-full" style={{ background: 'rgba(0,0,0,.25)' }}>📍 Vile Parle West</span>
            </div>
            {(!banners[0] || banners[0].title || banners[0].promo_code) && (
              <div className="absolute bottom-0 inset-x-0 px-3 pb-4 pt-10" style={banners[0] ? { background: 'linear-gradient(180deg, transparent, rgba(0,0,0,.62))', color: '#fff' } : {}}>
                <p className="text-[16px] font-black leading-tight max-w-[220px]">{banners[0]?.title || (banners[0] ? '' : 'Your offer banner photo shows here')}</p>
                {banners[0]?.subtitle && <p className="text-[10px] font-semibold opacity-90 mt-0.5">{banners[0].subtitle}</p>}
                {banners[0]?.promo_code && <span className="inline-block mt-2 text-[10px] font-black px-2 py-0.5 rounded-md border">{banners[0].promo_code}</span>}
              </div>
            )}
            {t.effects.shimmer && banners[0] && <span className="fv-anim absolute top-0 left-0 h-full w-1/4 bg-white/20" style={{ animation: 'fv-shine 4.5s ease-in-out infinite' }} />}
          </div>
          {banners.length > 1 && <div className="flex justify-center gap-1 mt-2">{banners.map((b, i) => <span key={b.id} className="h-1.5 rounded-full" style={{ width: i === 0 ? 14 : 6, background: i === 0 ? c.main : '#D7DEE6' }} />)}</div>}
          <div className="px-3 pt-3">
            {/* Greeting card */}
            <div className="relative overflow-hidden rounded-[18px]" style={{ background: c.header, color: onHeader }}>
              {t.header_image_url && <img src={t.header_image_url} alt="" className="absolute inset-0 w-full h-full object-cover" />}
              {t.header_image_url && <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, ${c.header}EB, ${c.header}59)` }} />}
              {t.effects.lights && (
                <svg viewBox="0 0 282 24" className="relative block w-full" height="22" aria-hidden>
                  <path d="M0 3 Q70 26 141 3 Q211 26 282 3" fill="none" stroke="rgba(0,0,0,.28)" strokeWidth="1" />
                  {[22, 56, 90, 124, 158, 192, 226, 260].map((x, i) => (
                    <circle key={x} className="fv-anim" cx={x} cy={i % 2 ? 17 : 13} r="3.2" fill={c.accent} style={{ animation: `fv-tw 1.8s ${i * 0.22}s ease-in-out infinite` }} />
                  ))}
                </svg>
              )}
              <div className="relative px-3 pb-3" style={{ paddingTop: t.effects.lights ? 2 : 12 }}>
                <p className="text-[17px] font-black leading-tight" style={{ color: onHeader === '#FFFFFF' ? c.accent : onHeader }}>{greet}</p>
                {t.subline && <p className="text-[11px] mt-1 opacity-90 font-semibold">{t.subline}</p>}
              </div>
            </div>
            {picks.length > 0 && <>
              <p className="text-[13px] font-black mt-3 mb-1.5">{t.featured_title || 'Festive picks'}</p>
              <div className="flex gap-2 overflow-hidden">
                {picks.slice(0, 3).map(s => <div key={s.id} className="shrink-0 w-[86px] rounded-xl p-2 text-[10px] font-bold" style={{ background: c.card, border: `1px solid ${c.main}55` }}>
                  <div className="h-10 rounded-lg mb-1" style={{ background: `${c.main}22` }} />{s.name}</div>)}
              </div>
            </>}
            <p className="text-[13px] font-black mt-3 mb-1.5">All services</p>
            <div className="grid grid-cols-4 gap-2">
              {['Home', 'Bath', 'Kitchen', 'Sofa'].map(x => <div key={x} className="rounded-xl p-2 text-center text-[9px] font-bold" style={{ background: c.card }}>
                <div className="w-6 h-6 rounded-md mx-auto mb-1" style={{ background: `${c.main}33`, border: `1.5px solid ${c.main}` }} />{x}</div>)}
            </div>
            <div className="mt-3 h-10 rounded-xl grid place-items-center text-[13px] font-black" style={{ background: c.main, color: onMain }}>Book now</div>
          </div>
          {t.effects.falling && (t.particle_image_url || t.pack === 'diwali') && [24, 120, 210].map((x, i) => (
            t.particle_image_url
              ? <img key={x} src={t.particle_image_url} alt="" className="fv-anim absolute top-0 w-4 h-4 pointer-events-none" style={{ left: x, animation: `fv-fall 5s ${i * 1.3}s linear infinite` }} />
              : <span key={x} className="fv-anim absolute top-0 w-2.5 h-3.5 pointer-events-none" style={{ left: x, borderRadius: '0 100% 0 100%', background: i === 1 ? '#EA580C' : '#F59E0B', animation: `fv-fall 5s ${i * 1.3}s linear infinite` }} />
          ))}
          <div className="absolute bottom-0 inset-x-0 flex justify-around py-2.5 text-[10px] font-bold" style={{ background: c.card, color: c.text, borderTop: '1px solid rgba(0,0,0,.06)' }}>
            <span className="px-2 py-0.5 rounded-full font-black" style={{ background: c.main, color: onMain }}>Home</span><span>Bookings</span><span>Offers</span><span>Account</span>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-slate-400 text-center mt-2 max-w-[300px] mx-auto">A close guide — the real app uses your actual screens. Use “Preview phones” to see it for real.</p>
    </div>
  )
}