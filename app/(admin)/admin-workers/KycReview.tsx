'use client'

import { useEffect, useState, useCallback } from 'react'

type KycSummary = {
  worker_id: string
  name: string
  phone: string
  status: string
  hasBank: boolean
  hasPan: boolean
  submitted_at: string | null
}
type KycDetail = {
  worker_id: string
  name: string
  phone: string
  email: string
  gender: string
  bank_holder: string | null
  bank_account: string | null
  bank_ifsc: string | null
  upi_id: string | null
  pan_number: string | null
  aadhaar_number: string | null
  status: string
  reject_reason: string | null
  submitted_at: string | null
  reviewed_at: string | null
}
type Consent = { doc_type: string; doc_version: string; accepted_at: string }

const STATUS: Record<string, { bg: string; fg: string; label: string }> = {
  incomplete: { bg: '#f1f5f9', fg: '#64748b', label: 'Incomplete' },
  submitted:  { bg: '#fef3c7', fg: '#b45309', label: 'Submitted' },
  verified:   { bg: '#dcfce7', fg: '#15803d', label: 'Verified' },
  rejected:   { bg: '#fee2e2', fg: '#b91c1c', label: 'Rejected' },
}

function StatusPill({ s }: { s: string }) {
  const st = STATUS[s] ?? STATUS.incomplete
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold"
      style={{ background: st.bg, color: st.fg }}>{st.label}</span>
  )
}

/**
 * Admin KYC review. Drop <KycReview /> anywhere (e.g. on the Workers page).
 * Lists workers' KYC; click one to see EVERY detail + documents, verify/reject.
 */
export default function KycReview() {
  const [list, setList] = useState<KycSummary[]>([])
  const [filter, setFilter] = useState<'submitted' | 'verified' | 'rejected' | 'all'>('submitted')
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/kyc', { cache: 'no-store' })
      const json = await res.json()
      setList(json.list ?? [])
    } catch { setList([]) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = list.filter((k) => filter === 'all' ? true : k.status === filter)
  const counts = {
    submitted: list.filter((k) => k.status === 'submitted').length,
    verified: list.filter((k) => k.status === 'verified').length,
    rejected: list.filter((k) => k.status === 'rejected').length,
  }

  return (
    <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-black text-slate-900">Worker verification (KYC)</h3>
          <p className="text-[11px] text-slate-400">Bank, ID documents, photo, signature & consent</p>
        </div>
        <div className="inline-flex p-1 rounded-xl bg-slate-100">
          {(['submitted', 'verified', 'rejected', 'all'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-colors ${
                filter === f ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-500'
              }`}>
              {f}{f !== 'all' && (counts as any)[f] > 0 ? ` (${(counts as any)[f]})` : ''}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-slate-400 text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-slate-600 font-bold text-sm">No {filter === 'all' ? '' : filter} records</p>
          <p className="text-[11px] text-slate-400 mt-1">Worker KYC submissions appear here.</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {filtered.map((k) => (
            <button key={k.worker_id} onClick={() => setOpenId(k.worker_id)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors">
              <div className="w-9 h-9 rounded-full bg-cyan-100 text-cyan-700 flex items-center justify-center font-black text-sm shrink-0">
                {k.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-800 text-sm truncate">{k.name}</p>
                <p className="text-[11px] text-slate-400">{k.phone}</p>
              </div>
              <StatusPill s={k.status} />
            </button>
          ))}
        </div>
      )}

      {openId && <KycDetailDrawer workerId={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  )
}

function KycDetailDrawer({ workerId, onClose, onChanged }: { workerId: string; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<KycDetail | null>(null)
  const [urls, setUrls] = useState<Record<string, string | null>>({})
  const [consents, setConsents] = useState<Consent[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/kyc?worker_id=${workerId}`, { cache: 'no-store' })
      const json = await res.json()
      setDetail(json.kyc)
      setUrls(json.urls ?? {})
      setConsents(json.consents ?? [])
    } finally { setLoading(false) }
  }, [workerId])

  useEffect(() => { load() }, [load])

  async function act(action: 'verify' | 'reject') {
    let reason: string | null = null
    if (action === 'reject') reason = window.prompt('Reason for rejection:') || null
    setBusy(true)
    try {
      await fetch('/api/kyc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: workerId, action, reason }),
      })
      await load()
      onChanged()
    } finally { setBusy(false) }
  }

  const docs: [string, string][] = [
    ['photo', 'Photograph'],
    ['pan', 'PAN card'],
    ['aadhaar_front', 'Aadhaar front'],
    ['aadhaar_back', 'Aadhaar back'],
    ['signature', 'Signature'],
  ]

  return (
    <div className="fixed inset-0 z-[9998] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-lg bg-white h-full overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {loading || !detail ? (
          <div className="p-8 text-center text-slate-400">Loading…</div>
        ) : (
          <>
            {/* header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between sticky top-0 bg-white z-10">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-black text-slate-900">{detail.name}</h2>
                  <StatusPill s={detail.status} />
                </div>
                <p className="text-sm text-slate-500">{detail.phone}</p>
              </div>
              <button onClick={onClose} className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 font-bold">✕</button>
            </div>

            <div className="p-5 space-y-5">
              {/* personal */}
              <Section title="Personal">
                <Field label="Email" value={detail.email || '—'} />
                <Field label="Gender" value={detail.gender || '—'} />
              </Section>

              {/* bank */}
              <Section title="Bank & payout">
                <Field label="Holder" value={detail.bank_holder || '—'} />
                <Field label="Account no." value={detail.bank_account || '—'} mono />
                <Field label="IFSC" value={detail.bank_ifsc || '—'} mono />
                <Field label="UPI ID" value={detail.upi_id || '—'} mono />
              </Section>

              {/* identity */}
              <Section title="Identity">
                <Field label="PAN" value={detail.pan_number || '—'} mono />
                <Field label="Aadhaar" value={detail.aadhaar_number || '—'} mono />
              </Section>

              {/* documents */}
              <div>
                <p className="text-[11px] font-black uppercase tracking-wide text-slate-400 mb-2">Documents</p>
                <div className="grid grid-cols-2 gap-3">
                  {docs.map(([key, label]) => (
                    <div key={key} className="rounded-xl border border-slate-200 overflow-hidden">
                      <div className="h-32 bg-slate-100 flex items-center justify-center">
                        {urls[key] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={urls[key]!} alt={label} className="w-full h-full object-cover cursor-zoom-in"
                            onClick={() => setZoom(urls[key]!)} />
                        ) : (
                          <span className="text-[11px] text-slate-400">Not uploaded</span>
                        )}
                      </div>
                      <p className="text-[11px] font-bold text-slate-600 px-2 py-1.5">{label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* consents */}
              <Section title="Legal consent">
                {consents.length === 0 ? (
                  <p className="text-sm text-slate-400">No consent records.</p>
                ) : (
                  consents.map((c, i) => (
                    <Field key={i} label={c.doc_type}
                      value={`${c.doc_version} · ${new Date(c.accepted_at).toLocaleDateString('en-IN')}`} />
                  ))
                )}
              </Section>

              {detail.reject_reason && (
                <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-sm text-red-700">
                  Rejected: {detail.reject_reason}
                </div>
              )}
            </div>

            {/* actions */}
            <div className="sticky bottom-0 bg-white border-t border-slate-100 p-4 flex gap-3">
              <button disabled={busy || detail.status === 'rejected'} onClick={() => act('reject')}
                className="flex-1 py-3 rounded-xl font-bold text-white disabled:opacity-40" style={{ background: '#dc2626' }}>
                Reject
              </button>
              <button disabled={busy || detail.status === 'verified'} onClick={() => act('verify')}
                className="flex-1 py-3 rounded-xl font-bold text-white disabled:opacity-40" style={{ background: '#16a34a' }}>
                {detail.status === 'verified' ? 'Verified ✓' : 'Verify worker'}
              </button>
            </div>
          </>
        )}
      </div>

      {zoom && (
        <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4" onClick={() => setZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="doc" className="max-w-full max-h-full rounded-xl" />
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-black uppercase tracking-wide text-slate-400 mb-2">{title}</p>
      <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">{children}</div>
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <span className="text-[13px] text-slate-500 capitalize">{label}</span>
      <span className={`text-[13px] font-bold text-slate-800 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}