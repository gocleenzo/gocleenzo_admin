'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type AreaRow = {
  id: string
  country: string
  state: string
  city: string
  area: string      // friendly display label, e.g. "Vile Parle East" — NOT the match key anymore
  parent_area: string | null // consolidated grouping label, e.g. "Vile Parle" — falls back to `area` when null
  pincode: string | null
  is_active: boolean
  created_at: string
}

const PINCODE_RE = /^[1-9][0-9]{5}$/ // Indian pincodes: 6 digits, doesn't start with 0

export default function AdminServiceAreas() {
  const supabase = createClient()

  const [rows, setRows] = useState<AreaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [country, setCountry] = useState('India')
  const [state, setState] = useState('')
  const [city, setCity] = useState('')

  const [newPincode, setNewPincode] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newParentArea, setNewParentArea] = useState('')
  const [adding, setAdding] = useState(false)

  const [editingParentId, setEditingParentId] = useState<string | null>(null)
  const [editingParentValue, setEditingParentValue] = useState('')
  const [savingParentId, setSavingParentId] = useState<string | null>(null)

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
        .order('pincode', { ascending: true })
      if (error) { setErr(error.message); setLoading(false); return }
      const all = (data ?? []) as AreaRow[]
      setRows(all)
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

  const states = Array.from(new Set(rows.map(r => r.state))).sort()
  const citiesForState = Array.from(
    new Set(rows.filter(r => r.state === state).map(r => r.city))
  ).sort()

  const currentAreas = rows.filter(
    r => r.country === country && r.state === state && r.city === city
  )
  const activeCount = currentAreas.filter(r => r.is_active).length
  const missingPincodeCount = currentAreas.filter(r => !r.pincode).length

  const existingParentAreas = Array.from(
    new Set(
      currentAreas
        .map(r => r.parent_area?.trim())
        .filter((p): p is string => !!p)
    )
  ).sort()

  async function toggleArea(row: AreaRow) {
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, is_active: !r.is_active } : r))
    const { error } = await supabase
      .from('service_areas')
      .update({ is_active: !row.is_active })
      .eq('id', row.id)
    if (error) {
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, is_active: row.is_active } : r))
      setErr(error.message)
    }
  }

  async function deleteArea(row: AreaRow) {
    const label = row.area || row.pincode || 'this entry'
    if (!window.confirm(`Remove "${label}" from ${row.city}? Customers in this pincode will no longer be able to book.`)) return
    setRows(prev => prev.filter(r => r.id !== row.id))
    const { error } = await supabase.from('service_areas').delete().eq('id', row.id)
    if (error) { setErr(error.message); await load() }
  }

  function startEditParent(row: AreaRow) {
    setEditingParentId(row.id)
    setEditingParentValue(row.parent_area ?? '')
  }

  function cancelEditParent() {
    setEditingParentId(null)
    setEditingParentValue('')
  }

  async function saveParentArea(row: AreaRow) {
    const value = editingParentValue.trim()
    setSavingParentId(row.id)
    const { error } = await supabase
      .from('service_areas')
      .update({ parent_area: value || null })
      .eq('id', row.id)
    setSavingParentId(null)
    if (error) {
      setErr(error.message)
      return
    }
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, parent_area: value || null } : r))
    setEditingParentId(null)
    setEditingParentValue('')
  }

  async function addArea() {
    const pincode = newPincode.trim()
    const label = newLabel.trim()
    const parentArea = newParentArea.trim()
    if (!PINCODE_RE.test(pincode)) {
      setErr('Enter a valid 6-digit pincode')
      return
    }
    if (!state || !city) return
    setAdding(true); setErr(null)
    try {
      const { data, error } = await supabase
        .from('service_areas')
        .insert({
          country, state, city, pincode,
          area: label || pincode,
          parent_area: parentArea || null,
          is_active: true,
        })
        .select('*')
        .single()
      if (error) {
        setErr(error.code === '23505'
          ? 'That pincode is already added for this city.'
          : error.message)
        setAdding(false)
        return
      }
      setRows(prev => [...prev, data as AreaRow])
      setNewPincode('')
      setNewLabel('')
      setNewParentArea('')
    } finally {
      setAdding(false)
    }
  }

  async function addCity() {
    const s = newState.trim(), c = newCity.trim()
    if (!s || !c) return
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
          Add the pincodes Cleenzo serves. A customer&apos;s address is matched by its
          exact pincode — customers outside these pincodes can still browse the app,
          but can&apos;t complete a booking.
        </p>
      </div>

      {err && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3">
          <p className="text-sm font-bold text-red-700">{err}</p>
        </div>
      )}

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

      {state && city ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-black text-slate-800">
              Pincodes in {city}, {state}
            </p>
            <span className="text-[11px] font-bold text-cyan-700 bg-cyan-50 px-2.5 py-1 rounded-full">
              {activeCount} active
            </span>
          </div>

          {missingPincodeCount > 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
              <p className="text-xs font-bold text-amber-800">
                {missingPincodeCount} area{missingPincodeCount > 1 ? 's' : ''} here {missingPincodeCount > 1 ? 'have' : 'has'} no pincode set —
                they won&apos;t match any customer until you add one (edit isn&apos;t supported yet;
                delete and re-add with a pincode).
              </p>
            </div>
          )}

          <div className="rounded-xl bg-cyan-50 border border-cyan-200 p-3">
            <p className="text-xs text-cyan-800">
              <span className="font-black">Group under</span> lets you show several pincodes
              (e.g. Vile Parle East + Vile Parle West) under one consolidated name on the
              Bookings page. Leave blank to keep an area showing under its own name.
            </p>
          </div>

          {loading ? (
            <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
          ) : currentAreas.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">
              No pincodes added yet for this city — add the first one below.
            </p>
          ) : (
            <div className="space-y-2">
              {currentAreas.map(row => (
                <div key={row.id}
                  className="px-4 py-3 rounded-xl border space-y-2"
                  style={{
                    background: row.is_active ? '#ECFEFF' : '#F8FAFC',
                    borderColor: row.is_active ? '#A5F3FC' : '#E2E8F0',
                  }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-sm font-black font-mono"
                        style={{ color: row.is_active ? '#0E7490' : '#94A3B8' }}>
                        {row.pincode || '——————'}
                      </span>
                      {row.area && (
                        <span className="text-sm font-semibold"
                          style={{ color: row.is_active ? '#0891B2' : '#94A3B8' }}>
                          {row.area}
                        </span>
                      )}
                      {row.parent_area && (
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                          📍 Grouped: {row.parent_area}
                        </span>
                      )}
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

                  {editingParentId === row.id ? (
                    <div className="flex flex-col sm:flex-row gap-2 pt-1">
                      <input
                        value={editingParentValue}
                        onChange={e => setEditingParentValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveParentArea(row) }}
                        placeholder="Group under (e.g. Vile Parle)"
                        list={`parent-suggestions-${row.id}`}
                        autoFocus
                        className="flex-1 px-3 py-1.5 rounded-lg border border-violet-200 text-sm outline-none focus:border-violet-400"
                      />
                      {existingParentAreas.length > 0 && (
                        <datalist id={`parent-suggestions-${row.id}`}>
                          {existingParentAreas.map(p => <option key={p} value={p} />)}
                        </datalist>
                      )}
                      <button onClick={() => saveParentArea(row)}
                        disabled={savingParentId === row.id}
                        className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-bold hover:bg-violet-700 disabled:opacity-40">
                        {savingParentId === row.id ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={cancelEditParent}
                        className="px-3 py-1.5 rounded-lg text-slate-500 text-xs font-bold hover:bg-white">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => startEditParent(row)}
                      className="text-[11px] font-bold text-violet-600 hover:text-violet-800">
                      {row.parent_area ? 'Edit group name' : '+ Group under an area name'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-slate-100">
            <input value={newPincode}
              onChange={e => setNewPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={e => { if (e.key === 'Enter') addArea() }}
              placeholder="Pincode (e.g. 400056)"
              inputMode="numeric"
              className="w-full sm:w-40 px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono outline-none focus:border-cyan-400" />
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addArea() }}
              placeholder="Label (optional, e.g. Vile Parle West)"
              className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-cyan-400" />
            <input value={newParentArea} onChange={e => setNewParentArea(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addArea() }}
              placeholder="Group under (optional, e.g. Vile Parle)"
              list="new-parent-suggestions"
              className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-violet-400" />
            {existingParentAreas.length > 0 && (
              <datalist id="new-parent-suggestions">
                {existingParentAreas.map(p => <option key={p} value={p} />)}
              </datalist>
            )}
            <button onClick={addArea} disabled={adding || !PINCODE_RE.test(newPincode)}
              className="px-4 py-2 rounded-xl bg-cyan-600 text-white text-sm font-bold hover:bg-cyan-700 disabled:opacity-40">
              {adding ? 'Adding…' : '+ Add'}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <p className="text-sm text-slate-400">
            Select or add a state and city above to manage its pincodes.
          </p>
        </div>
      )}
    </div>
  )
}