'use client'
import { useEffect, useState } from 'react'
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
}
type Review = {
  id: string; booking_id: string; service_rating: number; worker_rating: number
  comment: string; status: string; created_at: string
  customer: string; worker: string; service: string
}

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
  const [loading,    setLoading]    = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const [cRes, rRes] = await Promise.all([
        // Support queries — select everything, we map flexibly below.
        // Reading from the VIEW is fine and intentional — it gives us
        // the joined registered_name/registered_phone from `users` for
        // free, without a second query.
        supabase.from(SUPPORT_TABLE).select('*'),
        supabase
          .from('reviews')
          .select('id,service_rating,worker_rating,comment,status,created_at,booking_id,services(name),customer:users!customer_id(full_name),worker:users!worker_id(full_name)')
          .order('created_at', { ascending: false }),
      ])

      if (cRes.error) {
        console.error('support queries load error:', cRes.error.message)
      }
      if (cRes.data && cRes.data.length) {
        // detect whether a status column exists at all
        setHasStatus(Object.prototype.hasOwnProperty.call(cRes.data[0], 'status'))

        const mapped: Complaint[] = cRes.data.map((row: any) => ({
          id:          String(row.id),
          title:       pick(row, ['subject', 'type', 'category', 'title', 'topic']) ?? 'Support query',
          description: pick(row, ['description', 'message', 'query', 'details', 'body', 'complaint', 'text']) ?? '',
          status:      pick(row, ['status']) ?? 'open',
          created_at:  pick(row, ['created_at', 'inserted_at', 'date']),
          from:        pick(row, ['full_name', 'name', 'customer_name', 'customer', 'email', 'user_email'])
                        ?? (row.user_id ? `User ${String(row.user_id).slice(0, 8)}` : '—'),
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
      })))

      setLoading(false)
    }
    load()
  }, [])

  useEffect(() => { setFilter('all') }, [tab])

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

      {/* reviews summary strip */}
      {tab === 'reviews' && reviews.length > 0 && <ReviewSummary reviews={reviews} />}

      {/* filter pills */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-5">
        {[
          { k: 'all', label: 'All', color: CYAN[600] },
          ...Object.entries(tab === 'reviews' ? REVIEW_CFG : COMPLAINT_CFG)
            .map(([k, v]) => ({ k, label: v.label, color: v.color })),
        ].map(f => {
          const list  = tab === 'reviews' ? reviews : complaints
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
        ? <ReviewList    items={reviews}    filter={filter} onUpdate={updateReview} />
        : <ComplaintList items={complaints} filter={filter} hasStatus={hasStatus} onUpdate={updateComplaint} />}
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