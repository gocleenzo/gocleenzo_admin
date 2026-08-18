'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// ============================================================================
// Admin Services page — table layout
// ============================================================================
// Columns match the ACTUAL services table schema exactly (confirmed via
// information_schema.columns) — no pricing_type/duration_per_unit/
// unit_label, those don't exist on this table.
//
// Click any row to open the edit drawer. For most services that's the
// two fields requested — Original Price and Offer Price — plus Duration.
// BHK-priced services (Full House Cleaning, Dusting & Wiping, Sweeping &
// Mopping) get three price+duration pairs instead, since a single price
// wouldn't make sense for those.
// ============================================================================

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

function isBhkPriced(s: Service): boolean {
  return s.price_1bhk != null || s.price_2bhk != null || s.price_3bhk != null
}

export default function AdminServices() {
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [editing, setEditing] = useState<Service | null>(null)
  const supabase = createClient()

  async function load() {
    const { data, error } = await supabase
      .from('services')
      .select('id,name,category,is_active,base_price,original_price,duration_minutes,price_1bhk,price_2bhk,price_3bhk,duration_1bhk,duration_2bhk,duration_3bhk,price_30min,price_60min,price_90min')
      .order('category')
      .order('name')
    if (error) {
      console.error('Services load error:', error)
      setLoadError(error.message)
    } else if (data) {
      setServices(data as Service[])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const categories = ['all', ...Array.from(new Set(services.map(s => s.category || 'Uncategorised'))).sort()]

  const filtered = services.filter(s => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.category ?? '').toLowerCase().includes(search.toLowerCase())
    const matchCat = categoryFilter === 'all' || (s.category || 'Uncategorised') === categoryFilter
    return matchSearch && matchCat
  })

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin border-slate-200"
        style={{ borderTopColor: '#0891B2' }}/>
    </div>
  )

  return (
    <div className="min-h-screen px-4 md:px-8 py-7 bg-slate-50">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl"
            style={{ background: '#0891B214', border: '1px solid #0891B225' }}>🧾</div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 leading-tight tracking-tight">Services</h1>
            <p className="text-xs text-slate-400 font-medium">{services.length} services · edit price & duration</p>
          </div>
        </div>
        <input type="text" placeholder="Search service or category…" value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-4 py-2.5 rounded-xl text-sm text-slate-800 placeholder-slate-400 outline-none bg-white border border-slate-200 w-full md:w-72"/>
      </div>

      {loadError && (
        <div className="mb-4 rounded-xl px-4 py-3 bg-red-50 border border-red-200">
          <p className="text-sm font-bold text-red-600">Could not load services: {loadError}</p>
        </div>
      )}

      {/* Category filter pills */}
      <div className="flex gap-2 overflow-x-auto pb-3 mb-1">
        {categories.map(cat => (
          <button key={cat} onClick={() => setCategoryFilter(cat)}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all"
            style={{
              background: categoryFilter === cat ? '#CFFAFE' : '#fff',
              color:      categoryFilter === cat ? '#0891B2' : '#64748B',
              border:     `1px solid ${categoryFilter === cat ? '#0891B2' : '#E2E8F0'}`,
            }}>
            {cat === 'all' ? `All (${services.length})` : `${cat} (${services.filter(s => (s.category || 'Uncategorised') === cat).length})`}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                {['Service', 'Category', 'Original Price', 'Offer Price', 'Duration', 'Status', ''].map(c => (
                  <th key={c} className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wide whitespace-nowrap">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => {
                const bhk = isBhkPriced(s)
                return (
                  <tr key={s.id}
                    onClick={() => setEditing(s)}
                    className="border-b border-slate-50 hover:bg-slate-50/70 transition-colors cursor-pointer"
                    style={{ opacity: s.is_active ? 1 : 0.55 }}>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
                          style={{ background: '#ECFEFF', border: '1px solid #CFFAFE' }}>
                          {bhk ? '🏠' : '🧹'}
                        </div>
                        <span className="font-bold text-[13.5px] text-slate-800">{s.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-[12.5px] text-slate-500">{s.category || '—'}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      {bhk ? (
                        <span className="text-[11.5px] text-slate-400">
                          1B ₹{s.price_1bhk ?? '—'} · 2B ₹{s.price_2bhk ?? '—'} · 3B ₹{s.price_3bhk ?? '—'}
                        </span>
                      ) : s.original_price != null ? (
                        <span className="text-[13px] text-slate-400 line-through">₹{s.original_price}</span>
                      ) : (
                        <span className="text-[13px] text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      {bhk ? (
                        <span className="text-[11.5px] text-cyan-700 font-bold">tiered</span>
                      ) : (
                        <span className="text-[14px] font-black text-cyan-700">₹{s.base_price ?? '—'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      {bhk ? (
                        <span className="text-[11.5px] text-slate-400">
                          {s.duration_1bhk ?? '—'}/{s.duration_2bhk ?? '—'}/{s.duration_3bhk ?? '—'} min
                        </span>
                      ) : (
                        <span className="text-[13px] font-semibold text-slate-700">{s.duration_minutes ?? '—'} min</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-[11px] font-bold px-2 py-1 rounded-full whitespace-nowrap"
                        style={{
                          background: s.is_active ? '#D1FAE5' : '#FEE2E2',
                          color:      s.is_active ? '#059669' : '#DC2626',
                        }}>
                        {s.is_active ? '● Active' : '● Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right" onClick={e => e.stopPropagation()}>
                      <button onClick={() => setEditing(s)}
                        className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-cyan-50 text-cyan-700 border border-cyan-200 hover:bg-cyan-100 transition-all">
                        Edit
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && !loadError && (
          <div className="p-16 text-center">
            <p className="text-4xl mb-3">🔍</p>
            <p className="text-slate-700 font-bold">No services found</p>
            {search && (
              <p className="text-sm text-slate-400 mt-1">
                <button onClick={() => setSearch('')} className="text-cyan-600 font-bold hover:underline">
                  Clear search
                </button>
              </p>
            )}
          </div>
        )}
      </div>

      {editing && (
        <EditServiceModal
          service={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}

// ── Edit Modal (unchanged from before, still a drawer/modal, not a table) ──
function EditServiceModal({ service, onClose, onSaved }: {
  service: Service
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const bhk = isBhkPriced(service)

  const [originalPrice, setOriginalPrice] = useState(String(service.original_price ?? ''))
  const [offerPrice, setOfferPrice] = useState(String(service.base_price ?? ''))
  const [duration, setDuration] = useState(String(service.duration_minutes ?? ''))

  const [p1, setP1] = useState(String(service.price_1bhk ?? ''))
  const [p2, setP2] = useState(String(service.price_2bhk ?? ''))
  const [p3, setP3] = useState(String(service.price_3bhk ?? ''))
  const [d1, setD1] = useState(String(service.duration_1bhk ?? ''))
  const [d2, setD2] = useState(String(service.duration_2bhk ?? ''))
  const [d3, setD3] = useState(String(service.duration_3bhk ?? ''))

  const [isActive, setIsActive] = useState(service.is_active)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const update: Record<string, any> = { is_active: isActive }

      if (bhk) {
        if (p1 !== '') update.price_1bhk = Number(p1)
        if (p2 !== '') update.price_2bhk = Number(p2)
        if (p3 !== '') update.price_3bhk = Number(p3)
        if (d1 !== '') update.duration_1bhk = Number(d1)
        if (d2 !== '') update.duration_2bhk = Number(d2)
        if (d3 !== '') update.duration_3bhk = Number(d3)
      } else {
        update.original_price = originalPrice === '' ? null : Number(originalPrice)
        update.base_price = offerPrice === '' ? null : Number(offerPrice)
        update.duration_minutes = duration === '' ? null : Number(duration)
      }

      const { error: updateError } = await supabase
        .from('services')
        .update(update)
        .eq('id', service.id)

      if (updateError) { setError(updateError.message); setSaving(false); return }
      onSaved()
    } catch (e: any) {
      setError(e?.message ?? 'Could not save changes.')
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose}/>
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-white rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-black text-slate-800">Edit Service</h2>
            <p className="text-xs text-slate-400 mt-0.5">{service.name}</p>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-xl flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all">✕</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {bhk ? (
            <>
              <div className="rounded-xl px-3 py-2.5 bg-cyan-50 border border-cyan-200">
                <p className="text-[11px] text-cyan-700 font-semibold">
                  📐 This service is priced per home size (BHK) — set each tier's
                  price and duration below.
                </p>
              </div>
              {[
                { label: '1 BHK', price: p1, setPrice: setP1, dur: d1, setDur: setD1 },
                { label: '2 BHK', price: p2, setPrice: setP2, dur: d2, setDur: setD2 },
                { label: '3 BHK', price: p3, setPrice: setP3, dur: d3, setDur: setD3 },
              ].map(tier => (
                <div key={tier.label}>
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">{tier.label}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-slate-400 mb-1 block">Price (₹)</label>
                      <input type="number" min={0} value={tier.price}
                        onChange={e => tier.setPrice(e.target.value)}
                        className="w-full px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 mb-1 block">Duration (min)</label>
                      <input type="number" min={0} value={tier.dur}
                        onChange={e => tier.setDur(e.target.value)}
                        className="w-full px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
                    </div>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
                  Original Price (₹)
                </p>
                <input type="number" min={0} placeholder="Crossed-out reference price (optional)"
                  value={originalPrice} onChange={e => setOriginalPrice(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
                <p className="text-[11px] text-slate-400 mt-1.5">
                  Shown with a strikethrough next to the offer price. Leave
                  blank to hide the strikethrough entirely.
                </p>
              </div>

              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
                  Offer Price (₹) — what's actually charged
                </p>
                <input type="number" min={0} value={offerPrice}
                  onChange={e => setOfferPrice(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
              </div>

              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
                  Duration (minutes)
                </p>
                <input type="number" min={0} value={duration}
                  onChange={e => setDuration(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200"/>
              </div>

              {(service.price_30min != null || service.price_60min != null || service.price_90min != null) && (
                <div className="rounded-xl px-3 py-2.5 bg-amber-50 border border-amber-200">
                  <p className="text-[11px] text-amber-700 font-semibold">
                    ℹ️ This service also has quantity-tier prices (30/60/90 min:
                    ₹{service.price_30min ?? '—'} / ₹{service.price_60min ?? '—'} / ₹{service.price_90min ?? '—'}),
                    used by the cart's quantity stepper in the customer app.
                    Those aren't editable here yet — only the base Offer/Original
                    Price and Duration above.
                  </p>
                </div>
              )}
            </>
          )}

          <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-slate-50 border border-slate-200">
            <div>
              <p className="text-sm font-bold text-slate-700">Active</p>
              <p className="text-[11px] text-slate-400">Inactive services are hidden from customers</p>
            </div>
            <button onClick={() => setIsActive(!isActive)}
              className="relative w-11 h-6 rounded-full transition-all"
              style={{ background: isActive ? '#0891B2' : '#CBD5E1' }}>
              <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
                style={{ left: isActive ? '22px' : '2px' }}/>
            </button>
          </div>

          {error && (
            <div className="rounded-xl px-3 py-2.5 bg-red-50 border border-red-200">
              <p className="text-xs font-bold text-red-600">{error}</p>
            </div>
          )}

          <button onClick={save} disabled={saving}
            className="w-full h-11 rounded-xl font-black text-sm text-white disabled:opacity-40 active:scale-[0.98] transition-all"
            style={{ background: 'linear-gradient(135deg,#0891B2,#4F46E5)' }}>
            {saving ? '…' : '✓ Save Changes'}
          </button>
        </div>
      </div>
    </>
  )
}