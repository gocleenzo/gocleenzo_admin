'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Promo = {
  id: string; code: string; discount_type: string; discount_value: number
  max_discount_amount: number | null; min_order_amount: number | null
  usage_limit: number | null; used_count: number; is_active: boolean
  valid_until: string | null; description: string | null; created_at: string
}

type UsageRecord = {
  id: string; used_at: string
  user: { full_name: string | null; phone: string | null }
}

const EMPTY = {
  code: '', discount_type: 'percent', discount_value: '', max_discount_amount: '',
  min_order_amount: '', usage_limit: '', valid_until: '', description: ''
}

// ── Usage Drawer ────────────────────────────────────────────────
function UsageDrawer({ promo, onClose }: { promo: Promo; onClose: () => void }) {
  const [usage,   setUsage]   = useState<UsageRecord[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('promo_usage')
        .select('id, used_at, user:user_id(full_name, phone)')
        .eq('promo_id', promo.id)
        .order('used_at', { ascending: false })
      if (data) setUsage(data as any)
      setLoading(false)
    }
    load()
  }, [promo.id])

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose}/>
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md flex flex-col bg-white"
        style={{ borderLeft: '1px solid #E2E8F0', boxShadow: '-20px 0 60px rgba(0,0,0,0.1)' }}>

        {/* header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-black text-slate-800">Usage Details</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="font-mono font-black text-pink-600 text-base tracking-widest">{promo.code}</span>
              <span className="text-xs text-slate-400">· {promo.used_count} use{promo.used_count !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center">✕</button>
        </div>

        {/* promo summary */}
        <div className="px-5 py-3 border-b border-slate-100 bg-pink-50">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-black text-pink-700">
                {promo.discount_type === 'percent'
                  ? `${promo.discount_value}% off`
                  : `₹${promo.discount_value} off`}
                {promo.max_discount_amount ? ` · max ₹${promo.max_discount_amount}` : ''}
              </p>
              {promo.description && <p className="text-xs text-slate-500 mt-0.5">{promo.description}</p>}
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">Usage</p>
              <p className="text-sm font-black text-slate-700">
                {promo.used_count}{promo.usage_limit ? `/${promo.usage_limit}` : ''}
              </p>
            </div>
          </div>
        </div>

        {/* usage list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 rounded-full border-4 border-t-transparent animate-spin border-slate-200"
                style={{ borderTopColor: '#DB2777' }}/>
            </div>
          ) : usage.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
              <p className="text-3xl mb-3">📊</p>
              <p className="text-slate-600 font-bold">No usage yet</p>
              <p className="text-xs text-slate-400 mt-1">Usage records will appear here when customers apply this code</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {/* header row */}
              <div className="grid grid-cols-3 px-5 py-2.5 bg-slate-50">
                {['Customer', 'Phone', 'Date & Time'].map(h => (
                  <p key={h} className="text-[10px] font-black uppercase tracking-wider text-slate-400">{h}</p>
                ))}
              </div>

              {usage.map((u, i) => {
                const name  = u.user?.full_name ?? 'Unknown'
                const phone = u.user?.phone     ?? '—'
                const date  = new Date(u.used_at)
                return (
                  <div key={u.id} className="grid grid-cols-3 items-center px-5 py-3.5 hover:bg-slate-50 transition-all">
                    {/* name */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center font-black text-white text-xs flex-shrink-0"
                        style={{ background: `hsl(${(i * 67 + 220) % 360},55%,48%)` }}>
                        {name[0]?.toUpperCase() ?? '?'}
                      </div>
                      <p className="text-slate-800 font-semibold text-xs truncate">{name}</p>
                    </div>

                    {/* phone */}
                    <p className="text-slate-600 text-xs font-mono">
                      {phone !== '—' ? `+91 ${phone}` : '—'}
                    </p>

                    {/* date */}
                    <div>
                      <p className="text-slate-700 text-xs font-semibold">
                        {date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                      <p className="text-slate-400 text-[10px]">
                        {date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* footer total */}
        {usage.length > 0 && (
          <div className="px-5 py-4 border-t border-slate-100 bg-slate-50">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">Total customers who used this code</p>
              <p className="text-sm font-black text-pink-600">{usage.length}</p>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ── How It Works ────────────────────────────────────────────────
function HowItWorks() {
  return (
    <div className="bg-white rounded-2xl border border-blue-100 p-4 mb-5"
      style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
      <p className="text-xs font-black uppercase tracking-wider text-blue-600 mb-3">💡 How Promo Codes Work</p>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {[
          { icon: '➕', title: 'Admin Creates Code',  desc: 'Set discount, limits and expiry from this panel' },
          { icon: '📱', title: 'Customer Sees Code',  desc: 'Active codes appear on Flutter app promo screen' },
          { icon: '✍️', title: 'Customer Applies',    desc: 'Customer types code at checkout to get discount' },
          { icon: '💰', title: 'Discount Applied',    desc: 'Final amount reduced, usage count increases by 1' },
        ].map(s => (
          <div key={s.title} className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center text-base flex-shrink-0">{s.icon}</div>
            <div>
              <p className="text-xs font-black text-slate-700">{s.title}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Promo Form Drawer ───────────────────────────────────────────
function PromoForm({ mode, init, onClose, onSaved }: {
  mode: 'add'|'edit'; init: any; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState(init)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const supabase = createClient()
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }))

  const previewDiscount = () => {
    if (!form.discount_value) return null
    const val = Number(form.discount_value)
    if (form.discount_type === 'percent') {
      const example = 500
      const disc = Math.min(val / 100 * example, form.max_discount_amount ? Number(form.max_discount_amount) : Infinity)
      return `On ₹${example} order → ₹${Math.round(disc)} off → Pay ₹${example - Math.round(disc)}`
    }
    return `Flat ₹${val} off on every qualifying order`
  }
  const preview = previewDiscount()

  async function save() {
    if (!form.code.trim()) { setErr('Code is required'); return }
    if (!form.discount_value) { setErr('Discount value is required'); return }
    setSaving(true); setErr('')
    const payload = {
      code: form.code.trim().toUpperCase(), discount_type: form.discount_type,
      discount_value: Number(form.discount_value),
      max_discount_amount: form.max_discount_amount ? Number(form.max_discount_amount) : null,
      min_order_amount:    form.min_order_amount    ? Number(form.min_order_amount)    : null,
      usage_limit:         form.usage_limit         ? Number(form.usage_limit)         : null,
      valid_until: form.valid_until || null, description: form.description?.trim() || null, is_active: true,
    }
    if (mode === 'add') {
      const { error } = await supabase.from('promo_codes').insert({ ...payload, used_count: 0 })
      if (error) { setErr(error.message); setSaving(false); return }
    } else {
      const { error } = await supabase.from('promo_codes').update(payload).eq('id', form.id)
      if (error) { setErr(error.message); setSaving(false); return }
    }
    setSaving(false); onSaved()
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose}/>
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md flex flex-col bg-white"
        style={{ borderLeft: '1px solid #E2E8F0', boxShadow: '-20px 0 60px rgba(0,0,0,0.1)' }}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-black text-slate-800">{mode === 'add' ? '🎟 New Promo Code' : '✏️ Edit Promo'}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{mode === 'add' ? 'Will appear on customer app instantly' : 'Changes apply immediately'}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {preview && (
            <div className="rounded-2xl px-4 py-3 bg-pink-50 border border-pink-200">
              <p className="text-[10px] font-black uppercase tracking-wider text-pink-600 mb-1">💡 Live Preview</p>
              <p className="text-xs text-slate-600">{preview}</p>
            </div>
          )}
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1.5">Promo Code *</label>
            <input value={form.code} onChange={e => set('code', e.target.value.toUpperCase())}
              placeholder="e.g. CLEAN20, FIRST50"
              className="w-full px-4 py-3 rounded-xl text-slate-800 font-mono font-black text-base outline-none bg-white border border-slate-200 focus:border-pink-400 tracking-widest placeholder-slate-300"/>
            <p className="text-[10px] text-slate-400 mt-1">Customer types this exact code at checkout</p>
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1.5">Description (shown to customer)</label>
            <input value={form.description ?? ''} onChange={e => set('description', e.target.value)}
              placeholder="e.g. Get 20% off on first booking!"
              className="w-full px-4 py-3 rounded-xl text-slate-800 text-sm outline-none bg-white border border-slate-200 focus:border-pink-400 placeholder-slate-300"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1.5">Discount Type *</label>
              <div className="flex gap-2">
                {[{ value: 'percent', label: '% Off' }, { value: 'flat', label: '₹ Off' }].map(opt => (
                  <button key={opt.value} onClick={() => set('discount_type', opt.value)}
                    className="flex-1 py-2.5 rounded-xl text-xs font-black border transition-all"
                    style={{
                      background:  form.discount_type === opt.value ? '#FDF2F8' : '#F8FAFC',
                      color:       form.discount_type === opt.value ? '#DB2777' : '#94A3B8',
                      borderColor: form.discount_type === opt.value ? '#F9A8D4' : '#E2E8F0',
                    }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1.5">
                Value * {form.discount_type === 'percent' ? '(%)' : '(₹)'}
              </label>
              <input type="number" value={form.discount_value} onChange={e => set('discount_value', e.target.value)}
                placeholder={form.discount_type === 'percent' ? '20' : '100'}
                className="w-full px-4 py-2.5 rounded-xl text-slate-800 text-sm outline-none bg-white border border-slate-200 focus:border-pink-400"/>
            </div>
          </div>
          {form.discount_type === 'percent' && (
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1.5">Max Discount Cap (₹)</label>
              <input type="number" value={form.max_discount_amount} onChange={e => set('max_discount_amount', e.target.value)}
                placeholder="e.g. 150 (discount won't exceed this)"
                className="w-full px-4 py-2.5 rounded-xl text-slate-800 text-sm outline-none bg-white border border-slate-200 focus:border-pink-400 placeholder-slate-300"/>
              <p className="text-[10px] text-slate-400 mt-1">Leave empty for no cap</p>
            </div>
          )}
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1.5">Minimum Order Amount (₹)</label>
            <input type="number" value={form.min_order_amount} onChange={e => set('min_order_amount', e.target.value)}
              placeholder="e.g. 300"
              className="w-full px-4 py-2.5 rounded-xl text-slate-800 text-sm outline-none bg-white border border-slate-200 focus:border-pink-400 placeholder-slate-300"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1.5">Usage Limit</label>
              <input type="number" value={form.usage_limit} onChange={e => set('usage_limit', e.target.value)}
                placeholder="100"
                className="w-full px-4 py-2.5 rounded-xl text-slate-800 text-sm outline-none bg-white border border-slate-200 focus:border-pink-400"/>
              <p className="text-[10px] text-slate-400 mt-1">Times usable total</p>
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1.5">Valid Until</label>
              <input type="date" value={form.valid_until} onChange={e => set('valid_until', e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl text-slate-800 text-sm outline-none bg-white border border-slate-200 focus:border-pink-400"/>
              <p className="text-[10px] text-slate-400 mt-1">Empty = never expires</p>
            </div>
          </div>
          {/* customer app preview */}
          <div className="rounded-2xl p-4 border border-slate-200 bg-slate-50">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-3">📱 Customer App Preview</p>
            <div className="bg-white rounded-xl p-3 border border-pink-100" style={{ boxShadow: '0 2px 8px rgba(219,39,119,0.08)' }}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-black text-base font-mono tracking-widest text-pink-600">{form.code || 'YOURCODE'}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{form.description || 'Description here'}</p>
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {form.discount_value && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-pink-50 text-pink-600 border border-pink-200">
                        {form.discount_type === 'percent' ? `${form.discount_value}% off` : `₹${form.discount_value} off`}
                      </span>
                    )}
                    {form.min_order_amount && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">
                        Min ₹{form.min_order_amount}
                      </span>
                    )}
                    {form.valid_until && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                        Until {new Date(form.valid_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </div>
                </div>
                <div className="px-3 py-1.5 rounded-xl bg-pink-50 border border-pink-200 text-xs font-black text-pink-600 flex-shrink-0">Apply</div>
              </div>
            </div>
          </div>
          {err && <p className="text-sm font-bold text-red-600 bg-red-50 px-4 py-3 rounded-xl border border-red-200">⚠️ {err}</p>}
        </div>
        <div className="px-6 py-5 border-t border-slate-100 space-y-2">
          <button onClick={save} disabled={saving}
            className="w-full h-14 rounded-2xl text-white font-black text-base disabled:opacity-50 active:scale-[0.98] transition-all"
            style={{ background: 'linear-gradient(135deg,#DB2777,#BE185D)', boxShadow: '0 8px 24px rgba(219,39,119,0.25)' }}>
            {saving ? 'Saving…' : mode === 'add' ? '🎟 Create Promo Code' : '✓ Save Changes'}
          </button>
          {mode === 'add' && (
            <p className="text-[10px] text-center text-slate-400">Code will appear on customer app immediately</p>
          )}
        </div>
      </div>
    </>
  )
}

function DeleteModal({ promo, onClose, onDone }: { promo: Promo; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const supabase = createClient()
  async function del() {
    setBusy(true)
    await supabase.from('promo_codes').delete().eq('id', promo.id)
    setBusy(false); onDone()
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-3xl p-6 space-y-4 bg-white border border-red-200 shadow-2xl">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center text-3xl mx-auto mb-3">🗑️</div>
          <h3 className="text-slate-800 font-black text-lg">Delete Promo?</h3>
          <p className="text-sm text-slate-500 mt-1">
            <strong className="font-mono text-pink-600">{promo.code}</strong> will be removed from the customer app immediately.
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 h-12 rounded-2xl font-bold text-sm bg-slate-100 text-slate-500">Cancel</button>
          <button onClick={del} disabled={busy} className="flex-1 h-12 rounded-2xl font-black text-sm text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#EF4444,#DC2626)' }}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ───────────────────────────────────────────────────
export default function AdminPromos() {
  const [promos,      setPromos]      = useState<Promo[]>([])
  const [loading,     setLoading]     = useState(true)
  const [drawer,      setDrawer]      = useState<null|'add'|'edit'>(null)
  const [editing,     setEditing]     = useState<Promo | null>(null)
  const [toDelete,    setToDelete]    = useState<Promo | null>(null)
  const [usagePromo,  setUsagePromo]  = useState<Promo | null>(null)
  const [search,      setSearch]      = useState('')
  const supabase = createClient()

  async function load() {
    const { data } = await supabase.from('promo_codes').select('*').order('created_at', { ascending: false })
    if (data) setPromos(data)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function toggle(id: string, cur: boolean) {
    await supabase.from('promo_codes').update({ is_active: !cur }).eq('id', id)
    setPromos(p => p.map(x => x.id === id ? { ...x, is_active: !cur } : x))
  }

  function isExpired(p: Promo)   { return p.valid_until ? new Date(p.valid_until) < new Date() : false }
  function isExhausted(p: Promo) { return p.usage_limit != null ? p.used_count >= p.usage_limit : false }

  const filtered = promos.filter(p =>
    p.code.toLowerCase().includes(search.toLowerCase()) ||
    (p.description ?? '').toLowerCase().includes(search.toLowerCase())
  )
  const activeCount    = promos.filter(p => p.is_active && !isExpired(p) && !isExhausted(p)).length
  const expiredCount   = promos.filter(p => isExpired(p)).length
  const exhaustedCount = promos.filter(p => isExhausted(p) && !isExpired(p)).length
  const usedTotal      = promos.reduce((s, p) => s + p.used_count, 0)

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin border-slate-200"
        style={{ borderTopColor: '#DB2777' }}/>
    </div>
  )

  return (
    <div className="min-h-screen px-4 md:px-8 py-6 bg-slate-50">

      {/* header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-black text-slate-800">Promo Codes</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-sm text-slate-400">{promos.length} total</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700 border border-green-200">{activeCount} live on app</span>
            {expiredCount   > 0 && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-600 border border-red-200">{expiredCount} expired</span>}
            {exhaustedCount > 0 && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200">{exhaustedCount} exhausted</span>}
          </div>
        </div>
        <button onClick={() => setDrawer('add')}
          className="px-5 py-2.5 rounded-xl text-sm font-black text-white transition-all active:scale-95"
          style={{ background: 'linear-gradient(135deg,#DB2777,#BE185D)', boxShadow: '0 4px 12px rgba(219,39,119,0.3)' }}>
          + Add Promo
        </button>
      </div>

      <HowItWorks/>

      {/* summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total Codes',  value: promos.length, color: '#DB2777', bg: '#FDF2F8', icon: '🎟' },
          { label: 'Live on App',  value: activeCount,   color: '#059669', bg: '#ECFDF5', icon: '📱' },
          { label: 'Total Used',   value: usedTotal,     color: '#7C3AED', bg: '#F5F3FF', icon: '📊' },
          { label: 'Expired',      value: expiredCount,  color: '#DC2626', bg: '#FEF2F2', icon: '⏰' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-2xl p-4 border border-slate-100 hover:shadow-md transition-all"
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg mb-2" style={{ background: c.bg }}>{c.icon}</div>
            <p className="text-2xl font-black text-slate-800 leading-none mb-1">{c.value}</p>
            <p className="text-xs text-slate-400">{c.label}</p>
          </div>
        ))}
      </div>

      {/* search */}
      <div className="mb-4 relative">
        <input type="text" placeholder="Search promo codes…" value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-3 rounded-xl text-sm text-slate-800 placeholder-slate-400 outline-none bg-white border border-slate-200"/>
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
      </div>

      {/* promo cards */}
      <div className="grid md:grid-cols-2 gap-3">
        {filtered.map((p, i) => {
          const colors      = ['#DB2777','#7C3AED','#0891B2','#D97706','#059669','#DC2626']
          const c           = colors[i % colors.length]
          const usagePct    = p.usage_limit ? Math.round((p.used_count / p.usage_limit) * 100) : null
          const expired     = isExpired(p)
          const exhausted   = isExhausted(p)
          const liveOnApp   = p.is_active && !expired && !exhausted

          return (
            <div key={p.id} className="bg-white rounded-2xl overflow-hidden border transition-all hover:shadow-md"
              style={{ borderColor: liveOnApp ? '#FBD0E8' : '#F1F5F9', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', opacity: expired || exhausted ? 0.75 : 1 }}>

              <div className="h-1 w-full" style={{ background: liveOnApp ? c : '#E2E8F0' }}/>
              <div className="p-4">

                {/* top row */}
                <div className="flex items-start justify-between mb-3 gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-black text-xl font-mono tracking-widest" style={{ color: c }}>{p.code}</span>
                      {liveOnApp && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-green-100 text-green-700 border border-green-200 flex items-center gap-0.5">
                          <span className="w-1 h-1 rounded-full bg-green-500 animate-pulse"/>📱 Live
                        </span>
                      )}
                      {expired    && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-red-100 text-red-600">⏰ Expired</span>}
                      {exhausted && !expired && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500">✕ Exhausted</span>}
                      {!p.is_active && !expired && !exhausted && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-400">Paused</span>}
                    </div>
                    <p className="text-xs text-slate-500">
                      {p.discount_type === 'percent' ? `${p.discount_value}% off` : `₹${p.discount_value} off`}
                      {p.max_discount_amount ? ` · max ₹${p.max_discount_amount}` : ''}
                      {p.min_order_amount    ? ` · min ₹${p.min_order_amount}`    : ''}
                    </p>
                    {p.description && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{p.description}</p>}
                  </div>
                  <button onClick={() => toggle(p.id, p.is_active)} disabled={expired || exhausted}
                    className="px-3 py-1.5 rounded-xl text-xs font-black transition-all active:scale-95 border flex-shrink-0 disabled:opacity-40"
                    style={{
                      background:  p.is_active ? '#ECFDF5' : '#FEF2F2',
                      color:       p.is_active ? '#059669' : '#DC2626',
                      borderColor: p.is_active ? '#6EE7B7' : '#FCA5A5',
                    }}>
                    {p.is_active ? '● On' : '○ Off'}
                  </button>
                </div>

                {/* usage bar */}
                {usagePct !== null && (
                  <div className="mb-3">
                    <div className="flex justify-between mb-1">
                      <span className="text-[10px] text-slate-400">Usage</span>
                      <span className="text-[10px] font-bold" style={{ color: usagePct > 80 ? '#DC2626' : '#64748B' }}>
                        {p.used_count}/{p.usage_limit} ({usagePct}%)
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${Math.min(usagePct,100)}%`, background: usagePct > 80 ? '#EF4444' : c }}/>
                    </div>
                  </div>
                )}

                {/* info */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {[
                    { l: 'Used',      v: p.usage_limit ? `${p.used_count}/${p.usage_limit}` : `${p.used_count}×` },
                    { l: 'Min Order', v: p.min_order_amount ? `₹${p.min_order_amount}` : 'None' },
                    { l: 'Expires',   v: p.valid_until ? new Date(p.valid_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Never' },
                  ].map(s => (
                    <div key={s.l} className="rounded-xl p-2 text-center bg-slate-50 border border-slate-100">
                      <p className="text-slate-700 font-bold text-xs">{s.v}</p>
                      <p className="text-[9px] text-slate-400 mt-0.5">{s.l}</p>
                    </div>
                  ))}
                </div>

                {/* actions */}
                <div className="flex gap-2">
                  {/* 👥 Who Used This — key new button */}
                  <button onClick={() => setUsagePromo(p)}
                    className="flex-1 h-9 rounded-xl text-xs font-black border transition-all flex items-center justify-center gap-1.5"
                    style={{
                      background:  p.used_count > 0 ? '#FDF2F8' : '#F8FAFC',
                      color:       p.used_count > 0 ? '#DB2777' : '#94A3B8',
                      borderColor: p.used_count > 0 ? '#F9A8D4' : '#E2E8F0',
                    }}>
                    👥 {p.used_count > 0 ? `${p.used_count} used` : 'No usage'}
                  </button>
                  <button onClick={() => { setEditing(p); setDrawer('edit') }}
                    className="flex-1 h-9 rounded-xl text-xs font-black bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-all">
                    ✏️ Edit
                  </button>
                  <button onClick={() => setToDelete(p)}
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-xs bg-red-50 text-red-500 border border-red-200 hover:bg-red-100 transition-all">
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div className="col-span-2 rounded-2xl p-12 text-center bg-white border border-slate-100">
            <p className="text-3xl mb-3">🎟</p>
            <p className="text-slate-700 font-bold">{search ? 'No matching promo codes' : 'No promo codes yet'}</p>
            {!search && (
              <button onClick={() => setDrawer('add')} className="mt-4 px-5 py-2.5 rounded-xl text-white font-black text-sm"
                style={{ background: 'linear-gradient(135deg,#DB2777,#BE185D)' }}>
                + Create First Promo
              </button>
            )}
          </div>
        )}
      </div>

      {/* drawers */}
      {drawer === 'add' && (
        <PromoForm mode="add" init={{ ...EMPTY }} onClose={() => setDrawer(null)} onSaved={() => { setDrawer(null); load() }}/>
      )}
      {drawer === 'edit' && editing && (
        <PromoForm mode="edit"
          init={{
            id: editing.id, code: editing.code, discount_type: editing.discount_type,
            discount_value: String(editing.discount_value),
            max_discount_amount: editing.max_discount_amount ? String(editing.max_discount_amount) : '',
            min_order_amount:    editing.min_order_amount    ? String(editing.min_order_amount)    : '',
            usage_limit:         editing.usage_limit         ? String(editing.usage_limit)         : '',
            valid_until:         editing.valid_until ?? '',
            description:         editing.description ?? '',
          }}
          onClose={() => { setDrawer(null); setEditing(null) }}
          onSaved={() => { setDrawer(null); setEditing(null); load() }}/>
      )}
      {toDelete   && <DeleteModal promo={toDelete}   onClose={() => setToDelete(null)}   onDone={() => { setToDelete(null);  load() }}/>}
      {usagePromo && <UsageDrawer promo={usagePromo} onClose={() => setUsagePromo(null)}/>}
    </div>
  )
}