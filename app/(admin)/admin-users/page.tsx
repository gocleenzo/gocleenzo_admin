'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import AddressMapPicker, { PickedAddress } from '@/components/AddressMapPicker'

// ── Types ──────────────────────────────────────────────────────
type OrderRow = {
  id: string
  status: string
  final_amount: number
  scheduled_at: string
  created_at: string
  service_name: string
  worker_name: string
}

type CustomerRow = {
  id: string
  full_name: string
  phone: string
  email: string | null
  city: string | null
  is_active: boolean
  is_verified: boolean
  created_at: string
  // Default address, if any (is_default = true, is_deleted = false)
  default_address_id: string | null
  default_area: string | null
  default_city: string | null
  default_pincode: string | null
  default_full_address: string | null
  // NEW: needed so the "Edit Location" map can center on where the
  // pin currently (possibly wrongly) sits, rather than opening blank.
  default_lat: number | null
  default_lng: number | null
  // Derived from bookings
  orders: OrderRow[]
  totalOrders: number
  completedOrders: number
  cancelledOrders: number
  totalSpent: number
  lastOrderDate: string | null
}

const STATUS: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  pending:      { label: 'Pending',      color: '#D97706', bg: '#FEF3C7', icon: '⏳' },
  accepted:     { label: 'Assigned',     color: '#2563EB', bg: '#DBEAFE', icon: '👤' },
  otp_verified: { label: 'OTP Verified', color: '#7C3AED', bg: '#EDE9FE', icon: '🔓' },
  in_progress:  { label: 'In Progress',  color: '#0891B2', bg: '#CFFAFE', icon: '⚡' },
  completed:    { label: 'Completed',    color: '#059669', bg: '#D1FAE5', icon: '✓' },
  cancelled:    { label: 'Cancelled',    color: '#DC2626', bg: '#FEE2E2', icon: '✕' },
}

type SortKey = 'orders' | 'spent' | 'recent'

// Helper: build the best available one-line address string for a customer
function formatAddress(c: Pick<CustomerRow, 'default_full_address' | 'default_area' | 'default_city' | 'default_pincode'>): string | null {
  if (c.default_full_address) return c.default_full_address
  const parts = [c.default_area, c.default_city, c.default_pincode].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}

// ── NEW: Edit Location modal — thin wrapper around the existing
// AddressMapPicker component (already used elsewhere in this admin
// panel), scoped to updating ONE existing address row's coordinates
// directly. This is the admin-side counterpart to the customer app's
// own "Edit Location" feature on Saved Addresses — for cases where a
// worker reports a wrong address but the customer won't fix it
// themselves.
function EditLocationModal({
  addressId, initialLat, initialLng, onClose, onSaved,
}: {
  addressId: string
  initialLat: number | null
  initialLng: number | null
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const [picked, setPicked] = useState<PickedAddress | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!picked) return
    setSaving(true)
    setError(null)
    const patch: Record<string, any> = {
      latitude: picked.lat,
      longitude: picked.lng,
    }
    // Only overwrite the text fields if reverse-geocoding actually
    // returned something — a dropped pin with a failed reverse-geocode
    // still updates the coordinates (the part that actually matters
    // for sending a worker to the right place) without blanking out
    // perfectly good existing address text.
    if (picked.fullAddress) patch.full_address = picked.fullAddress
    if (picked.area) patch.area = picked.area
    if (picked.city) patch.city = picked.city
    if (picked.pincode) patch.pincode = picked.pincode

    const { error: err } = await supabase.from('addresses').update(patch).eq('id', addressId)
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-black text-slate-800">📍 Fix Address Location</h3>
          <button onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all">✕</button>
        </div>
        <p className="text-xs text-slate-400 mb-3">
          Drag the pin to the customer's real location, or search for the correct address above the map.
        </p>
        <AddressMapPicker
          initialLat={initialLat}
          initialLng={initialLng}
          heightClass="h-72"
          onPick={setPicked}
        />
        {picked?.fullAddress && (
          <div className="mt-3 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
            <p className="text-xs text-slate-600">{picked.fullAddress}</p>
          </div>
        )}
        {error && (
          <p className="text-xs font-bold text-red-600 mt-2">{error}</p>
        )}
        <button onClick={save} disabled={!picked || saving}
          className="w-full mt-4 py-2.5 rounded-xl font-black text-white text-sm disabled:opacity-40 transition-opacity"
          style={{ background: '#0891B2' }}>
          {saving ? 'Saving…' : 'Save New Location'}
        </button>
      </div>
    </div>
  )
}

// ── Drawer: full profile + order history ────────────────────────
function UserDrawer({
  user, onClose, onReload,
}: {
  user: CustomerRow
  onClose: () => void
  onReload: () => void
}) {
  const address = formatAddress(user)
  const [editingLocation, setEditingLocation] = useState(false)

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose}/>
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg flex flex-col bg-white"
        style={{ borderLeft: '1px solid #E2E8F0', boxShadow: '-20px 0 60px rgba(0,0,0,0.1)' }}>

        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-white font-black text-lg flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#0891B2,#4F46E5)' }}>
              {user.full_name?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-800">{user.full_name}</h2>
              <p className="text-xs text-slate-400 mt-0.5">{user.phone}</p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-xl flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl p-3.5 text-center bg-cyan-50 border border-cyan-200">
              <p className="text-xl font-black text-cyan-700">{user.totalOrders}</p>
              <p className="text-[10px] font-bold text-slate-500 mt-0.5">Total Orders</p>
            </div>
            <div className="rounded-2xl p-3.5 text-center bg-green-50 border border-green-200">
              <p className="text-xl font-black text-green-700">{user.completedOrders}</p>
              <p className="text-[10px] font-bold text-slate-500 mt-0.5">Completed</p>
            </div>
            <div className="rounded-2xl p-3.5 text-center bg-violet-50 border border-violet-200">
              <p className="text-lg font-black text-violet-700">₹{user.totalSpent.toLocaleString('en-IN')}</p>
              <p className="text-[10px] font-bold text-slate-500 mt-0.5">Total Spent</p>
            </div>
          </div>

          {/* Profile info */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Profile</p>
            <div className="rounded-2xl px-4 py-4 space-y-2 bg-slate-50 border border-slate-200">
              {[
                { label: 'Phone', value: user.phone },
                { label: 'Email', value: user.email || '—' },
                { label: 'Status', value: user.is_active ? '🟢 Active' : '⚪ Inactive' },
                { label: 'Verified', value: user.is_verified ? '✓ Verified' : '⏳ Not verified' },
                { label: 'Joined', value: new Date(user.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) },
              ].map(r => (
                <div key={r.label} className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">{r.label}</span>
                  <span className="text-sm text-slate-800 font-medium">{r.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Default address */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Default Address</p>
              {/* NEW: only shown when there's an actual address row to
                  edit — a customer with no saved address has nothing
                  to correct here yet. */}
              {user.default_address_id && (
                <button onClick={() => setEditingLocation(true)}
                  className="flex items-center gap-1 text-[11px] font-bold text-cyan-700 hover:text-cyan-800 transition-colors">
                  📍 Edit Location
                </button>
              )}
            </div>
            {address ? (
              <div className="rounded-2xl px-4 py-3 bg-amber-50 border border-amber-200">
                <p className="text-sm text-slate-700">📍 {address}</p>
                {user.default_pincode && (
                  <p className="text-xs text-slate-400 mt-1">Pincode: {user.default_pincode}</p>
                )}
              </div>
            ) : (
              <div className="rounded-2xl px-4 py-3 bg-slate-50 border border-slate-200">
                <p className="text-sm text-slate-400">No saved address yet</p>
              </div>
            )}
          </div>

          {/* Order history */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
              Order History {user.orders.length > 0 ? `· ${user.orders.length}` : ''}
            </p>
            {user.orders.length === 0 ? (
              <div className="rounded-2xl px-4 py-8 text-center bg-slate-50 border border-slate-200">
                <p className="text-3xl mb-2">📭</p>
                <p className="text-sm font-bold text-slate-500">No orders yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {user.orders.map(o => {
                  const cfg = STATUS[o.status] ?? STATUS.pending
                  return (
                    <div key={o.id} className="rounded-2xl px-4 py-3 bg-white border border-slate-200">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-800 truncate">{o.service_name}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {new Date(o.scheduled_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            {' · '}
                            {new Date(o.scheduled_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                          {o.worker_name && (
                            <p className="text-[11px] text-slate-400 mt-0.5">Worker: {o.worker_name}</p>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className="text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap"
                            style={{ background: cfg.bg, color: cfg.color }}>
                            {cfg.icon} {cfg.label}
                          </span>
                          <p className="text-sm font-black text-cyan-700 mt-1.5">₹{o.final_amount.toLocaleString('en-IN')}</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {editingLocation && user.default_address_id && (
        <EditLocationModal
          addressId={user.default_address_id}
          initialLat={user.default_lat}
          initialLng={user.default_lng}
          onClose={() => setEditingLocation(false)}
          onSaved={onReload}
        />
      )}
    </>
  )
}

// ── Main Page ──────────────────────────────────────────────────
export default function AdminUsers() {
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('recent')
  const [selected, setSelected] = useState<CustomerRow | null>(null)
  const supabase = createClient()

  const load = useCallback(async () => {
    setLoading(true)

    // NOTE: 'customer' is assumed to be the exact value stored in
    // users.role for regular app users (as opposed to 'worker' / 'admin').
    // If your role enum uses a different value, change it here.
    const [{ data: userRows }, { data: addrRows }, { data: bookingRows }] = await Promise.all([
      supabase.from('users')
        .select('id,full_name,phone,email,city,is_active,is_verified,created_at,is_deleted')
        .eq('role', 'customer')
        .eq('is_deleted', false)
        .order('created_at', { ascending: false }),
      // NEW: also select id/latitude/longitude — needed so "Edit
      // Location" knows exactly which address row to update, and can
      // center the map on where the pin currently (possibly wrongly)
      // sits instead of opening blank.
      supabase.from('addresses')
        .select('id,user_id,area,city,pincode,full_address,latitude,longitude,is_default,is_deleted')
        .eq('is_default', true)
        .eq('is_deleted', false),
      supabase.from('bookings')
        .select(
          `id,customer_id,status,final_amount,scheduled_at,created_at,
           services(name),
           worker:users!worker_id(full_name),
           booking_items(service_name,services(name))`
        )
        .order('scheduled_at', { ascending: false }),
    ])

    const addrByUser: Record<string, any> = {}
    ;(addrRows ?? []).forEach((a: any) => { addrByUser[a.user_id] = a })

    const ordersByUser: Record<string, OrderRow[]> = {}
    ;(bookingRows ?? []).forEach((b: any) => {
      if (!b.customer_id) return
      const items = (b.booking_items ?? []) as any[]
      const serviceName = items.length > 0
        ? items.map((it: any) => it.service_name ?? it.services?.name ?? 'Service').join(', ')
        : (b.services?.name ?? 'Service')
      const row: OrderRow = {
        id: b.id,
        status: b.status,
        final_amount: b.final_amount ?? 0,
        scheduled_at: b.scheduled_at,
        created_at: b.created_at,
        service_name: serviceName,
        worker_name: b.worker?.full_name ?? '',
      }
      if (!ordersByUser[b.customer_id]) ordersByUser[b.customer_id] = []
      ordersByUser[b.customer_id].push(row)
    })

    const rows: CustomerRow[] = (userRows ?? []).map((u: any) => {
      const addr = addrByUser[u.id]
      const orders = ordersByUser[u.id] ?? []
      const completed = orders.filter(o => o.status === 'completed')
      const cancelled = orders.filter(o => o.status === 'cancelled')
      const totalSpent = completed.reduce((s, o) => s + o.final_amount, 0)
      const lastOrderDate = orders.length > 0 ? orders[0].scheduled_at : null

      return {
        id: u.id,
        full_name: u.full_name ?? 'Customer',
        phone: u.phone ?? '—',
        email: u.email ?? null,
        city: u.city ?? null,
        is_active: u.is_active !== false,
        is_verified: u.is_verified === true,
        created_at: u.created_at,
        default_address_id: addr?.id ?? null,
        default_area: addr?.area ?? null,
        default_city: addr?.city ?? null,
        default_pincode: addr?.pincode ?? null,
        default_full_address: addr?.full_address ?? null,
        default_lat: addr?.latitude ?? null,
        default_lng: addr?.longitude ?? null,
        orders,
        totalOrders: orders.length,
        completedOrders: completed.length,
        cancelledOrders: cancelled.length,
        totalSpent,
        lastOrderDate,
      }
    })

    setCustomers(rows)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // keep an open drawer in sync with fresh data
  useEffect(() => {
    setSelected(prev => (prev ? (customers.find(c => c.id === prev.id) ?? prev) : prev))
  }, [customers])

  const filtered = customers.filter(c => {
    const q = search.toLowerCase()
    const addr = formatAddress(c)?.toLowerCase() ?? ''
    return (
      c.full_name.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      (c.email ?? '').toLowerCase().includes(q) ||
      addr.includes(q)
    )
  })

  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === 'orders') return b.totalOrders - a.totalOrders
    if (sortKey === 'spent')  return b.totalSpent - a.totalSpent
    // recent: most recently active first, users with no orders last (by signup date)
    const aT = a.lastOrderDate ? new Date(a.lastOrderDate).getTime() : new Date(a.created_at).getTime()
    const bT = b.lastOrderDate ? new Date(b.lastOrderDate).getTime() : new Date(b.created_at).getTime()
    return bT - aT
  })

  const totalCustomers = customers.length
  const activeCustomers = customers.filter(c => c.totalOrders > 0).length
  const totalRevenue = customers.reduce((s, c) => s + c.totalSpent, 0)

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin border-slate-200"
          style={{ borderTopColor: '#0891B2' }}/>
        <p className="text-sm text-slate-400">Loading users…</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen px-4 md:px-8 py-7 bg-slate-50">

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl"
            style={{ background: '#0891B214', border: '1px solid #0891B225' }}>👥</div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 leading-tight tracking-tight">Users</h1>
            <p className="text-xs text-slate-400 font-medium">{totalCustomers} customers · {activeCustomers} with orders</p>
          </div>
        </div>
        <input type="text" placeholder="Search name, phone, email, address…" value={search} onChange={e => setSearch(e.target.value)}
          className="px-4 py-2.5 rounded-xl text-sm text-slate-800 placeholder-slate-400 outline-none bg-white border border-slate-200 w-full md:w-72"/>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-2xl p-3.5 bg-white border border-slate-200/80 shadow-sm">
          <p className="text-xl font-black text-slate-800">{totalCustomers}</p>
          <p className="text-[11px] font-bold text-slate-500 mt-0.5">Total Customers</p>
        </div>
        <div className="rounded-2xl p-3.5 bg-white border border-slate-200/80 shadow-sm">
          <p className="text-xl font-black text-cyan-700">{activeCustomers}</p>
          <p className="text-[11px] font-bold text-slate-500 mt-0.5">Have Ordered</p>
        </div>
        <div className="rounded-2xl p-3.5 bg-white border border-slate-200/80 shadow-sm">
          <p className="text-xl font-black text-green-700">₹{totalRevenue.toLocaleString('en-IN')}</p>
          <p className="text-[11px] font-bold text-slate-500 mt-0.5">Total Revenue</p>
        </div>
      </div>

      {/* Sort pills */}
      <div className="flex gap-2 mb-3">
        {[
          { key: 'recent', label: '🕒 Most Recent' },
          { key: 'orders', label: '📦 Most Orders' },
          { key: 'spent',  label: '💰 Highest Spend' },
        ].map(opt => (
          <button key={opt.key} onClick={() => setSortKey(opt.key as SortKey)}
            className="px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all"
            style={{
              background: sortKey === opt.key ? '#CFFAFE' : '#fff',
              color: sortKey === opt.key ? '#0891B2' : '#64748B',
              border: `1px solid ${sortKey === opt.key ? '#0891B2' : '#E2E8F0'}`,
            }}>
            {opt.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {sorted.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center shadow-sm">
          <p className="text-4xl mb-3">👥</p>
          <p className="text-slate-700 font-bold">No users found</p>
          <p className="text-sm text-slate-400 mt-1">Try a different search</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  {['Customer','Address','Orders','Total Spent','Last Order',''].map(c => (
                    <th key={c} className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wide whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(c => {
                  const address = formatAddress(c)
                  return (
                    <tr key={c.id}
                      className="border-b border-slate-50 hover:bg-slate-50/70 transition-colors cursor-pointer"
                      onClick={() => setSelected(c)}>
                      {/* Customer */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-black flex-shrink-0"
                            style={{ background: 'linear-gradient(135deg,#0891B2,#4F46E5)' }}>
                            {c.full_name?.[0]?.toUpperCase() ?? '?'}
                          </div>
                          <div className="min-w-0">
                            <p className="font-black text-slate-800 text-[13px] truncate max-w-[160px]">{c.full_name}</p>
                            <a href={`tel:${c.phone}`} onClick={e => e.stopPropagation()}
                              className="text-[11px] text-cyan-600 font-bold hover:underline">{c.phone}</a>
                          </div>
                        </div>
                      </td>
                      {/* Address */}
                      <td className="px-4 py-3.5 max-w-[240px]">
                        {address ? (
                          <>
                            <p className="text-[12px] font-bold text-slate-700 truncate" title={address}>
                              📍 {address}
                            </p>
                            {c.default_pincode && (
                              <p className="text-[10px] text-slate-400">PIN {c.default_pincode}</p>
                            )}
                          </>
                        ) : (
                          <span className="text-[11px] text-slate-300">No address saved</span>
                        )}
                      </td>
                      {/* Orders */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="text-[13px] font-black text-slate-700">{c.totalOrders}</span>
                        {c.totalOrders > 0 && (
                          <p className="text-[10px] text-slate-400">{c.completedOrders} completed</p>
                        )}
                      </td>
                      {/* Total spent */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="text-[13px] font-black text-cyan-700">₹{c.totalSpent.toLocaleString('en-IN')}</span>
                      </td>
                      {/* Last order */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {c.lastOrderDate
                          ? <span className="text-[12px] text-slate-600 font-semibold">
                              {new Date(c.lastOrderDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </span>
                          : <span className="text-[11px] text-slate-300">Never</span>}
                      </td>
                      {/* Chevron */}
                      <td className="px-4 py-3.5 text-right">
                        <span className="text-slate-300">›</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && (
        <UserDrawer user={selected} onClose={() => setSelected(null)} onReload={load} />
      )}
    </div>
  )
}