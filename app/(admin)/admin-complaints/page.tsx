'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/* ───────────────────────────── config ─────────────────────────────
   The "complaints" tab now reads from the SUPPORT QUERIES table.
   UPDATES must go against the REAL table — admin_support_queries is a
   read-only VIEW (joins support_queries + users for display), and
   Postgres correctly refuses UPDATE against a view like that, which is
   what "cannot update view admin_support_queries" meant. Reads still
   work fine against the view (harmless, gives us the joined names for
   free) — only the update calls needed to target the real table.      */
const SUPPORT_TABLE = 'admin_support_queries'   // used for SELECT (read)
const SUPPORT_WRITE_TABLE = 'support_queries'   // used for UPDATE (write) — the real table backing the view above

/* ───────────────────────────── types ───────────────────────────── */
type Complaint = {
  id: string; title: string; description: string
  status: string; created_at: string | null; from: string
  // professional(s) this complaint is about — the booking's professional,
  // a worker_id on the row, or the professional who raised it themselves
  proIds: string[]
}
type Review = {
  id: string; booking_id: string; service_rating: number; worker_rating: number
  comment: string; status: string; created_at: string
  customer: string; worker: string; service: string
  worker_id: string | null
}
type Pro = { id: string; name: string; phone: string }

/* pick the first key that exists & is non-empty on a row */
function pick(row: any, keys: string[]): string | null {
  for (const k of keys) {
    const v = row?.[k]
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v)
  }
  return null
}

/* ───────────────────────────── theme ───────────────────────────── */
const CYAN  = { 50: '#ECFEFF', 100: '#CFFAFE', 500: '#06B6D4', 600: '#0891B2', 700: '#0E7490' }
const STAR  = '#F59E0B'
const INK   = '#0F172A'
const BODY  = '#475569'
const MUTED = '#64748B'
const FAINT = '#94A3B8'
const LINE  = '#E2E8F0'
const CARD  = '#FFFFFF'
const PAGE  = '#F8FAFC'

const COMPLAINT_CFG: Record<string, { color: string; label: string }> = {
  open:        { color: '#DC2626', label: 'Open'        },
  in_progress: { color: '#D97706', label: 'In Progress' },
  resolved:    { color: '#059669', label: 'Resolved'    },
  closed:      { color: '#64748B', label: 'Closed'      },
}
const REVIEW_CFG: Record<string, { color: string; label: string }> = {
  published: { color: CYAN[600], label: 'Published' },
  featured:  { color: '#D97706', label: 'Featured'  },
  hidden:    { color: '#64748B', label: 'Hidden'    },
}

/* ───────────────────────────── page ───────────────────────────── */
export default function AdminFeedback() {
  const [tab,        setTab]        = useState<'complaints' | 'reviews'>('reviews')
  const [complaints, setComplaints] = useState<Complaint[]>([])
  const [hasStatus,  setHasStatus]  = useState(true)
  const [reviews,    setReviews]    = useState<Review[]>([])
  const [filter,     setFilter]     = useState('all')
  const [pros,       setPros]       = useState<Pro[]>([])
  const [proFilter,  setProFilter]  = useState<string>('all')
  const [loading,    setLoading]    = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const [cRes, rRes, pRes] = await Promise.all([
        // Support queries — select everything, we map flexibly below.
        // Reading from the VIEW is fine and intentional — it gives us
        // the joined registered_name/registered_phone from `users` for
        // free, without a second query.
        supabase.from(SUPPORT_TABLE).select('*'),
        supabase
          .from('reviews')
          .select('id,service_rating,worker_rating,comment,status,created_at,booking_id,worker_id,services(name),customer:users!customer_id(full_name),worker:users!worker_id(full_name)')
          .order('created_at', { ascending: false }),
        // every professional, for the Professional filter
        supabase.from('users').select('id, full_name, phone').eq('role', 'worker'),
      ])

      if (pRes.data) {
        setPros(pRes.data.map((u: any) => ({
          id: String(u.id),
          name: u.full_name || `Professional ${String(u.id).slice(0, 6)}`,
          phone: u.phone ?? '',
        })))
      }

      if (cRes.error) {
        console.error('support queries load error:', cRes.error.message)
      }
      if (cRes.data && cRes.data.length) {
        // detect whether a status column exists at all
        setHasStatus(Object.prototype.hasOwnProperty.call(cRes.data[0], 'status'))

        // complaints linked to a booking → find that booking's professional
        const bookingIds = Array.from(new Set(
          cRes.data.map((row: any) => row.booking_id).filter(Boolean).map(String)))
        const bookingWorker: Record<string, string> = {}
        if (bookingIds.length) {
          const { data: bks } = await supabase
            .from('bookings').select('id, worker_id').in('id', bookingIds)
          ;(bks ?? []).forEach((b: any) => { if (b.worker_id) bookingWorker[String(b.id)] = String(b.worker_id) })
        }

        const mapped: Complaint[] = cRes.data.map((row: any) => ({
          id:          String(row.id),
          title:       pick(row, ['subject', 'type', 'category', 'title', 'topic']) ?? 'Support query',
          description: pick(row, ['description', 'message', 'query', 'details', 'body', 'complaint', 'text']) ?? '',
          status:      pick(row, ['status']) ?? 'open',
          created_at:  pick(row, ['created_at', 'inserted_at', 'date']),
          from:        pick(row, ['full_name', 'name', 'customer_name', 'customer', 'email', 'user_email'])
                        ?? (row.user_id ? `User ${String(row.user_id).slice(0, 8)}` : '—'),
          proIds:      [
            row.worker_id ? String(row.worker_id) : null,
            row.booking_id ? bookingWorker[String(row.booking_id)] ?? null : null,
            row.user_id ? String(row.user_id) : null,   // raised by the professional
          ].filter((x): x is string => !!x),
        }))
        // newest first (created_at may be missing on some rows)
        mapped.sort((a, b) =>
          new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
        setComplaints(mapped)
      } else {
        setComplaints([])
      }

      if (rRes.data) setReviews(rRes.data.map((r: any) => ({
        id: r.id, booking_id: r.booking_id,
        service_rating: r.service_rating ?? 0, worker_rating: r.worker_rating ?? 0,
        comment: r.comment, status: r.status ?? 'published', created_at: r.created_at,
        customer: r.customer?.full_name ?? 'Customer',
        worker:   r.worker?.full_name   ?? 'Worker',
        service:  r.services?.name      ?? 'Service',
        worker_id: r.worker_id ? String(r.worker_id) : null,
      })))

      setLoading(false)
    }
    load()
  }, [])

  useEffect(() => { setFilter('all') }, [tab])

  // ── Professional filter ──
  const proReviews = useMemo(
    () => proFilter === 'all' ? reviews : reviews.filter(r => r.worker_id === proFilter),
    [reviews, proFilter])
  const proComplaints = useMemo(
    () => proFilter === 'all' ? complaints : complaints.filter(c => c.proIds.includes(proFilter)),
    [complaints, proFilter])

  // how many reviews / complaints each professional has (for the dropdown)
  const proCounts = useMemo(() => {
    const m: Record<string, { reviews: number; complaints: number }> = {}
    const get = (id: string) => (m[id] ??= { reviews: 0, complaints: 0 })
    reviews.forEach(r => { if (r.worker_id) get(r.worker_id).reviews++ })
    const proSet = new Set(pros.map(p => p.id))
    complaints.forEach(c => {
      new Set(c.proIds.filter(id => proSet.has(id))).forEach(id => get(id).complaints++)
    })
    return m
  }, [reviews, complaints, pros])

  const selectedPro = pros.find(p => p.id === proFilter) ?? null

  async function updateComplaint(id: string, status: string) {
    const prev = complaints
    setComplaints(c => c.map(x => x.id === id ? { ...x, status } : x))
    // Writes MUST target the real table — admin_support_queries is a
    // read-only view (SELECT sq.*, u.full_name, u.phone FROM
    // support_queries sq LEFT JOIN users u ...) and Postgres refuses
    // UPDATE against a multi-table view like this. support_queries has
    // every column being written here (status), so this is a direct,
    // safe swap — no trigger or view change needed.
    const { error } = await supabase.from(SUPPORT_WRITE_TABLE).update({ status }).eq('id', id)
    if (error) {
      console.error('status update failed:', error.message)
      setComplaints(prev) // revert on failure
      alert('Could not update status: ' + error.message)
    }
  }
  async function updateReview(id: string, status: string) {
    await supabase.from('reviews').update({ status }).eq('id', id)
    setReviews(r => r.map(x => x.id === id ? { ...x, status } : x))
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: PAGE }}>
      <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin"
        style={{ borderColor: CYAN[100], borderTopColor: CYAN[600] }} />
    </div>
  )

  return (
    <div className="min-h-screen px-4 md:px-8 py-6" style={{ background: PAGE }}>
      <div className="mb-5">
        <h1 className="text-2xl font-black" style={{ color: INK }}>Feedback</h1>
        <p className="text-sm mt-1" style={{ color: MUTED }}>
          {complaints.length} complaints · {reviews.length} reviews
        </p>
      </div>

      {/* tab switch */}
      <div className="inline-flex p-1 rounded-2xl mb-5" style={{ background: CYAN[50], border: `1px solid ${LINE}` }}>
        {([['reviews', 'Reviews'], ['complaints', 'Complaints']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className="px-5 py-2 rounded-xl text-sm font-bold transition-all"
            style={{
              background: tab === k ? CARD : 'transparent',
              color:      tab === k ? CYAN[700] : MUTED,
              boxShadow:  tab === k ? '0 1px 3px rgba(8,145,178,0.12)' : 'none',
            }}>
            {label} ({k === 'reviews' ? reviews.length : complaints.length})
          </button>
        ))}
      </div>

      {/* professional filter */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <ProPicker
          pros={pros}
          counts={proCounts}
          tab={tab}
          value={proFilter}
          onChange={setProFilter}
        />
        {selectedPro && (
          <button onClick={() => setProFilter('all')}
            className="text-xs font-bold px-3 py-2 rounded-xl"
            style={{ color: MUTED, background: CARD, border: `1px solid ${LINE}` }}>
            ✕ Clear
          </button>
        )}
      </div>

      {/* selected professional's summary */}
      {selectedPro && (
        <ProSummary pro={selectedPro} reviews={proReviews} complaints={proComplaints} />
      )}

      {/* reviews summary strip */}
      {tab === 'reviews' && !selectedPro && proReviews.length > 0 && <ReviewSummary reviews={proReviews} />}

      {/* filter pills */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-5">
        {[
          { k: 'all', label: 'All', color: CYAN[600] },
          ...Object.entries(tab === 'reviews' ? REVIEW_CFG : COMPLAINT_CFG)
            .map(([k, v]) => ({ k, label: v.label, color: v.color })),
        ].map(f => {
          const list  = tab === 'reviews' ? proReviews : proComplaints
          const count = f.k === 'all' ? list.length : list.filter(x => x.status === f.k).length
          const on    = filter === f.k
          return (
            <button key={f.k} onClick={() => setFilter(f.k)}
              className="px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap flex-shrink-0 transition-all"
              style={{
                background: on ? `${f.color}1A` : CARD,
                color:      on ? f.color : MUTED,
                border:     `1px solid ${on ? f.color + '55' : LINE}`,
              }}>
              {f.label} ({count})
            </button>
          )
        })}
      </div>

      {tab === 'reviews'
        ? <ReviewList    items={proReviews}    filter={filter} onUpdate={updateReview} />
        : <ComplaintList items={proComplaints} filter={filter} hasStatus={hasStatus} onUpdate={updateComplaint} />}
    </div>
  )
}

/* ───────────────────────── shared bits ───────────────────────── */
function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl p-12 text-center" style={{ background: CARD, border: `1px solid ${LINE}` }}>
      <div className="text-5xl mb-3">🗂️</div>
      <p className="font-semibold text-sm" style={{ color: MUTED }}>{text}</p>
    </div>
  )
}

function Stars({ n }: { n: number }) {
  const v = Math.max(0, Math.min(5, Math.round(n)))
  return (
    <span className="text-sm tracking-tight">
      <span style={{ color: STAR }}>{'★'.repeat(v)}</span>
      <span style={{ color: LINE }}>{'★'.repeat(5 - v)}</span>
    </span>
  )
}

/* ───────────────────────── professional picker ───────────────────────── */
function ProPicker({ pros, counts, tab, value, onChange }: {
  pros: Pro[]
  counts: Record<string, { reviews: number; complaints: number }>
  tab: 'complaints' | 'reviews'
  value: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const countOf = (id: string) => {
    const c = counts[id]
    return c ? (tab === 'reviews' ? c.reviews : c.complaints) : 0
  }

  // professionals with the most reviews/complaints first, then A–Z
  const list = pros
    .filter(p => {
      const t = q.trim().toLowerCase()
      return !t || p.name.toLowerCase().includes(t) || p.phone.includes(t)
    })
    .sort((a, b) => countOf(b.id) - countOf(a.id) || a.name.localeCompare(b.name))

  const selected = pros.find(p => p.id === value)

  return (
    <div className="relative" ref={boxRef}>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all"
        style={{
          background: selected ? CYAN[50] : CARD,
          color: selected ? CYAN[700] : INK,
          border: `1px solid ${selected ? CYAN[500] + '66' : LINE}`,
        }}>
        <span>👷</span>
        <span className="max-w-[220px] truncate">{selected ? selected.name : 'All professionals'}</span>
        <span style={{ color: FAINT }}>▾</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-2 w-[300px] rounded-2xl overflow-hidden"
          style={{ background: CARD, border: `1px solid ${LINE}`, boxShadow: '0 12px 32px rgba(15,23,42,0.14)' }}>
          <div className="p-2" style={{ borderBottom: `1px solid ${LINE}` }}>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search name or phone…"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: PAGE, border: `1px solid ${LINE}`, color: INK }} />
          </div>
          <div className="max-h-[320px] overflow-y-auto py-1">
            <button onClick={() => { onChange('all'); setOpen(false); setQ('') }}
              className="w-full text-left px-4 py-2.5 text-sm font-bold hover:bg-slate-50"
              style={{ color: value === 'all' ? CYAN[700] : INK }}>
              All professionals
            </button>
            {list.map(p => {
              const n = countOf(p.id)
              const on = p.id === value
              return (
                <button key={p.id} onClick={() => { onChange(p.id); setOpen(false); setQ('') }}
                  className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-slate-50"
                  style={{ background: on ? CYAN[50] : undefined }}>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold truncate" style={{ color: on ? CYAN[700] : INK }}>{p.name}</span>
                    {p.phone && <span className="block text-[11px]" style={{ color: FAINT }}>{p.phone}</span>}
                  </span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0"
                    style={{ background: n ? (tab === 'reviews' ? '#FEF3C7' : '#FEE2E2') : PAGE,
                             color: n ? (tab === 'reviews' ? '#B45309' : '#B91C1C') : FAINT }}>
                    {n} {tab === 'reviews' ? (n === 1 ? 'review' : 'reviews') : (n === 1 ? 'complaint' : 'complaints')}
                  </span>
                </button>
              )
            })}
            {list.length === 0 && (
              <p className="px-4 py-6 text-center text-xs" style={{ color: FAINT }}>No professional found</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ───────────────────────── selected professional summary ───────────────────────── */
function ProSummary({ pro, reviews, complaints }: { pro: Pro; reviews: Review[]; complaints: Complaint[] }) {
  const rated = reviews.map(r => r.worker_rating).filter(Boolean)
  const avg = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : 0
  const openCount = complaints.filter(c => c.status === 'open' || c.status === 'in_progress').length
  const low = reviews.filter(r => r.worker_rating > 0 && r.worker_rating <= 2).length

  const tiles = [
    { label: 'Avg rating', value: rated.length ? avg.toFixed(1) : '—', extra: rated.length ? <Stars n={avg} /> : null },
    { label: 'Reviews', value: String(reviews.length), extra: low ? <span className="text-[11px] font-bold" style={{ color: '#B91C1C' }}>{low} low (1–2★)</span> : null },
    { label: 'Complaints', value: String(complaints.length), extra: null },
    { label: 'Still open', value: String(openCount), extra: null, warn: openCount > 0 },
  ]

  return (
    <div className="rounded-2xl p-4 mb-5" style={{ background: CARD, border: `1px solid ${LINE}` }}>
      <p className="text-sm font-black mb-3" style={{ color: INK }}>
        👷 {pro.name}{pro.phone && <span className="font-semibold ml-2" style={{ color: FAINT }}>{pro.phone}</span>}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {tiles.map(t => (
          <div key={t.label} className="rounded-xl p-3" style={{ background: PAGE, border: `1px solid ${LINE}` }}>
            <p className="text-[11px] font-semibold mb-1" style={{ color: MUTED }}>{t.label}</p>
            <p className="text-xl font-black" style={{ color: t.warn ? '#DC2626' : INK }}>{t.value}</p>
            {t.extra && <div className="mt-0.5">{t.extra}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ───────────────────────── reviews summary ───────────────────────── */
function ReviewSummary({ reviews }: { reviews: Review[] }) {
  const avg = (key: 'service_rating' | 'worker_rating') => {
    const vals = reviews.map(r => r[key]).filter(Boolean)
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : 0
  }
  const cards = [
    { label: 'Avg service rating', value: avg('service_rating') },
    { label: 'Avg worker rating',  value: avg('worker_rating')  },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 mb-5 max-w-md">
      {cards.map(c => (
        <div key={c.label} className="rounded-2xl p-4"
          style={{ background: CARD, border: `1px solid ${LINE}` }}>
          <p className="text-xs font-semibold mb-1" style={{ color: MUTED }}>{c.label}</p>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-black" style={{ color: INK }}>{c.value.toFixed(1)}</span>
            <Stars n={c.value} />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ───────────────────────── reviews list ───────────────────────── */
function ReviewList({ items, filter, onUpdate }: {
  items: Review[]; filter: string; onUpdate: (id: string, s: string) => void
}) {
  const filtered = filter === 'all' ? items : items.filter(r => r.status === filter)
  if (filtered.length === 0) return <Empty text="No reviews here" />

  return (
    <div className="space-y-3">
      {filtered.map(r => {
        const cfg = REVIEW_CFG[r.status] ?? REVIEW_CFG.published
        return (
          <div key={r.id} className="rounded-2xl p-4"
            style={{
              background: CARD,
              border: `1px solid ${r.status === 'featured' ? '#D9770655' : LINE}`,
              boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
            }}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full"
                    style={{ background: `${cfg.color}14`, color: cfg.color }}>
                    {cfg.label}
                  </span>
                </div>
                {/* two distinct ratings */}
                <div className="flex flex-col gap-1 mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs w-14" style={{ color: MUTED }}>Service</span>
                    <Stars n={r.service_rating} />
                    <span className="text-xs font-bold" style={{ color: INK }}>{r.service}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs w-14" style={{ color: MUTED }}>Worker</span>
                    <Stars n={r.worker_rating} />
                    <span className="text-xs font-bold" style={{ color: INK }}>{r.worker}</span>
                  </div>
                </div>
                <p className="text-xs mt-1" style={{ color: MUTED }}>by {r.customer}</p>
              </div>
              <p className="text-[10px] flex-shrink-0" style={{ color: FAINT }}>
                {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </p>
            </div>
            <p className="text-sm leading-relaxed mb-4" style={{ color: BODY }}>
              {r.comment || <span style={{ color: FAINT }}>No written message</span>}
            </p>
            <div className="flex gap-2 flex-wrap">
              {[
                { s: 'featured',  label: '⭐ Feature', color: '#D97706' },
                { s: 'published', label: '👁 Publish', color: CYAN[600] },
                { s: 'hidden',    label: '🚫 Hide',    color: '#64748B' },
              ].map(a => (
                <button key={a.s} onClick={() => onUpdate(r.id, a.s)} disabled={r.status === a.s}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all disabled:opacity-30"
                  style={{ background: `${a.color}12`, color: a.color, border: `1px solid ${a.color}33` }}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ───────────────────────── complaints / support list ───────────────────────── */
function ComplaintList({ items, filter, hasStatus, onUpdate }: {
  items: Complaint[]; filter: string; hasStatus: boolean; onUpdate: (id: string, s: string) => void
}) {
  const filtered = filter === 'all' ? items : items.filter(c => c.status === filter)
  if (filtered.length === 0) return <Empty text="No complaints / support queries here" />

  return (
    <div className="space-y-3">
      {filtered.map(c => {
        const cfg = COMPLAINT_CFG[c.status] ?? COMPLAINT_CFG.open
        return (
          <div key={c.id} className="rounded-2xl p-4"
            style={{ background: CARD, border: `1px solid ${LINE}`, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full"
                    style={{ background: `${cfg.color}14`, color: cfg.color }}>
                    {cfg.label}
                  </span>
                  <span className="text-xs" style={{ color: FAINT }}>Support</span>
                </div>
                <p className="font-semibold text-sm capitalize" style={{ color: INK }}>
                  {c.title?.replace(/_/g, ' ')}
                </p>
                <p className="text-xs mt-0.5" style={{ color: MUTED }}>by {c.from}</p>
              </div>
              <p className="text-[10px] flex-shrink-0" style={{ color: FAINT }}>
                {c.created_at
                  ? new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                  : ''}
              </p>
            </div>
            <p className="text-sm leading-relaxed mb-4" style={{ color: BODY }}>
              {c.description || <span style={{ color: FAINT }}>No message</span>}
            </p>
            {hasStatus && (
              <div className="flex gap-2 flex-wrap">
                {[
                  { s: 'in_progress', label: '🔄 Working',  color: '#D97706' },
                  { s: 'resolved',    label: '✅ Resolved', color: '#059669' },
                  { s: 'closed',      label: '🔒 Close',    color: '#64748B' },
                ].map(a => (
                  <button key={a.s} onClick={() => onUpdate(c.id, a.s)} disabled={c.status === a.s}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all disabled:opacity-30"
                    style={{ background: `${a.color}12`, color: a.color, border: `1px solid ${a.color}33` }}>
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}