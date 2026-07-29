'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type AreaRow = {
  id: string
  country: string
  state: string
  city: string
  area: string
  is_active: boolean
  created_at: string
}

export default function AdminServiceAreas() {
  const supabase = createClient()

  const [rows, setRows] = useState<AreaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // location selector state
  const [country, setCountry] = useState('India')
  const [state, setState] = useState('')
  const [city, setCity] = useState('')

  // new-area input
  const [newArea, setNewArea] = useState('')
  const [adding, setAdding] = useState(false)

  // "add new city" mini-form toggle
  const [showNewCity, setShowNewCity] = useState(false)
  const [newState, setNewState] = useState('')
  const [newCity, setNewCity] = useState('')

  async function load() {
    setLoading(true); setErr(null)
    try {
      const { data, error } = await supabase
        .from('service_areas')
        .select('*')
        .order('country', { ascending: true })
        .order('state', { ascending: true })
        .order('city', { ascending: true })
        .order('area', { ascending: true })
      if (error) { setErr(error.message); setLoading(false); return }
      const all = (data ?? []) as AreaRow[]
      setRows(all)
      // default the selector to the first existing state/city, if any and
      // nothing is selected yet
      if (!state && all.length > 0) {
        setState(all[0].state)
        setCity(all[0].city)
      }
    } catch (e: any) {
      setErr(e?.message ?? 'Could not load service areas')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  // Distinct states / cities derived from existing rows, for the selectors.
  const states = Array.from(new Set(rows.map(r => r.state))).sort()
  const citiesForState = Array.from(
    new Set(rows.filter(r => r.state === state).map(r => r.city))
  ).sort()

  const currentAreas = rows.filter(
    r => r.country === country && r.state === state && r.city === city
  )
  const activeCount = currentAreas.filter(r => r.is_active).length

  async function toggleArea(row: AreaRow) {
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, is_active: !r.is_active } : r))
    const { error } = await supabase
      .from('service_areas')
      .update({ is_active: !row.is_active })
      .eq('id', row.id)
    if (error) {
      // revert on failure
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, is_active: row.is_active } : r))
      setErr(error.message)
    }
  }

  async function deleteArea(row: AreaRow) {
    if (!window.confirm(`Remove "${row.area}" from ${row.city}? Customers there will no longer be able to book.`)) return
    setRows(prev => prev.filter(r => r.id !== row.id))
    const { error } = await supabase.from('service_areas').delete().eq('id', row.id)
    if (error) { setErr(error.message); await load() }
  }

  async function addArea() {
    const name = newArea.trim()
    if (!name || !state || !city) return
    setAdding(true); setErr(null)
    try {
      const { data, error } = await supabase
        .from('service_areas')
        .insert({ country, state, city, area: name, is_active: true })
        .select('*')
        .single()
      if (error) { setErr(error.message); setAdding(false); return }
      setRows(prev => [...prev, data as AreaRow])
      setNewArea('')
    } finally {
      setAdding(false)
    }
  }

  async function addCity() {
    const s = newState.trim(), c = newCity.trim()
    if (!s || !c) return
    // Just switch the selector to this new state/city — the city doesn't
    // exist as a "thing" in the DB until the first area is added to it.
    setState(s)
    setCity(c)
    setShowNewCity(false)
    setNewState('')
    setNewCity('')
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black text-slate-800">Service Areas</h1>
        <p className="text-sm text-slate-500 mt-1">
          Choose which areas Cleenzo is available in. Customers outside these areas can
          still browse the app, but can&apos;t complete a booking.
        </p>
      </div>

      {err && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3">
          <p className="text-sm font-bold text-red-700">{err}</p>
        </div>
      )}

      {/* Location selector */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <p className="text-xs font-black uppercase tracking-wide text-slate-400">
          Country / State / City
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <p className="text-[11px] text-slate-500 mb-1">Country</p>
            <input value={country} onChange={e => setCountry(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 outline-none focus:border-cyan-400" />
          </div>
          <div>
            <p className="text-[11px] text-slate-500 mb-1">State</p>
            <select value={state} onChange={e => { setState(e.target.value); setCity('') }}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 outline-none focus:border-cyan-400 bg-white">
              <option value="">Select state…</option>
              {states.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <p className="text-[11px] text-slate-500 mb-1">City</p>
            <select value={city} onChange={e => setCity(e.target.value)}
              disabled={!state}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 outline-none focus:border-cyan-400 bg-white disabled:bg-slate-50 disabled:text-slate-400">
              <option value="">Select city…</option>
              {citiesForState.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {!showNewCity ? (
          <button onClick={() => setShowNewCity(true)}
            className="text-[12px] font-bold text-cyan-700 hover:text-cyan-800">
            + Add a new state / city
          </button>
        ) : (
          <div className="rounded-xl bg-cyan-50 border border-cyan-200 p-3 space-y-2">
            <p className="text-[11px] font-black text-cyan-800">New state / city</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input value={newState} onChange={e => setNewState(e.target.value)}
                placeholder="State (e.g. Maharashtra)"
                className="flex-1 px-3 py-2 rounded-lg border border-cyan-200 text-sm outline-none" />
              <input value={newCity} onChange={e => setNewCity(e.target.value)}
                placeholder="City (e.g. Mumbai)"
                className="flex-1 px-3 py-2 rounded-lg border border-cyan-200 text-sm outline-none" />
              <button onClick={addCity}
                className="px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-bold hover:bg-cyan-700">
                Use this
              </button>
              <button onClick={() => setShowNewCity(false)}
                className="px-3 py-2 rounded-lg text-slate-500 text-sm font-bold hover:bg-white">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Areas for the selected city */}
      {state && city ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-black text-slate-800">
              Areas in {city}, {state}
            </p>
            <span className="text-[11px] font-bold text-cyan-700 bg-cyan-50 px-2.5 py-1 rounded-full">
              {activeCount} active
            </span>
          </div>

          {loading ? (
            <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
          ) : currentAreas.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">
              No areas added yet for this city — add the first one below.
            </p>
          ) : (
            <div className="space-y-2">
              {currentAreas.map(row => (
                <div key={row.id}
                  className="flex items-center justify-between px-4 py-3 rounded-xl border"
                  style={{
                    background: row.is_active ? '#ECFEFF' : '#F8FAFC',
                    borderColor: row.is_active ? '#A5F3FC' : '#E2E8F0',
                  }}>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold" style={{ color: row.is_active ? '#0E7490' : '#94A3B8' }}>
                      {row.area}
                    </span>
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full"
                      style={{
                        background: row.is_active ? '#DCFCE7' : '#F1F5F9',
                        color: row.is_active ? '#15803D' : '#94A3B8',
                      }}>
                      {row.is_active ? 'Live' : 'Disabled'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => toggleArea(row)}
                      className="relative w-11 h-6 rounded-full transition-colors"
                      style={{ background: row.is_active ? '#0891B2' : '#CBD5E1' }}>
                      <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
                        style={{ left: row.is_active ? '22px' : '2px' }} />
                    </button>
                    <button onClick={() => deleteArea(row)}
                      className="text-slate-400 hover:text-red-600 text-sm">
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add new area */}
          <div className="flex gap-2 pt-2 border-t border-slate-100">
            <input value={newArea} onChange={e => setNewArea(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addArea() }}
              placeholder="Add an area (e.g. Vile Parle)"
              className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-cyan-400" />
            <button onClick={addArea} disabled={adding || !newArea.trim()}
              className="px-4 py-2 rounded-xl bg-cyan-600 text-white text-sm font-bold hover:bg-cyan-700 disabled:opacity-40">
              {adding ? 'Adding…' : '+ Add'}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <p className="text-sm text-slate-400">
            Select or add a state and city above to manage its areas.
          </p>
        </div>
      )}
    </div>
  )
}