'use client'
import { useEffect, useState } from 'react'

type Assistant = {
  id: string
  full_name: string
  email: string
  role: string
  is_active: boolean
  created_at: string
}

export default function AdminAssistantsPage() {
  const [assistants, setAssistants] = useState<Assistant[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // form state
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [creating, setCreating] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [formOk, setFormOk] = useState<string | null>(null)

  const [toggling, setToggling] = useState<string | null>(null)

  async function load() {
    setLoading(true); setErr(null)
    try {
      const res = await fetch('/api/admin-auth/create-assistant', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) { setErr(json?.error ?? 'Could not load assistants'); setAssistants([]); return }
      setAssistants(json.assistants ?? [])
    } catch (e: any) {
      setErr(e?.message ?? 'Could not load assistants')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function createAssistant(e: React.FormEvent) {
    e.preventDefault()
    setFormErr(null); setFormOk(null)

    if (!fullName.trim() || !email.trim() || !password) {
      setFormErr('Name, email and password are all required'); return
    }
    if (password.length < 8) {
      setFormErr('Password must be at least 8 characters'); return
    }

    setCreating(true)
    try {
      const res = await fetch('/api/admin-auth/create-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: fullName.trim(), email: email.trim().toLowerCase(), password }),
      })
      const json = await res.json()
      if (!res.ok || !json?.success) {
        setFormErr(json?.error ?? 'Could not create assistant'); return
      }
      setFormOk(`Assistant "${json.assistant.full_name}" created. Share their email and password so they can log in at /login.`)
      setFullName(''); setEmail(''); setPassword('')
      await load()
    } catch (e: any) {
      setFormErr(e?.message ?? 'Could not create assistant')
    } finally {
      setCreating(false)
    }
  }

  // Toggles an assistant's active state via the existing
  // toggle-assistant route (blocks/unblocks their login without
  // deleting the account).
  async function toggleActive(a: Assistant) {
    setToggling(a.id)
    try {
      const res = await fetch('/api/admin-auth/toggle-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id, is_active: !a.is_active }),
      })
      const json = await res.json()
      if (!res.ok || json?.error) {
        alert(json?.error ?? 'Could not update assistant'); return
      }
      await load()
    } catch (e: any) {
      alert(e?.message ?? 'Could not update assistant')
    } finally {
      setToggling(null)
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-black text-gray-900">Assistants</h1>
        <p className="text-sm text-gray-400 mt-1">
          Create a login for an assistant. They'll be able to sign in at{' '}
          <code className="text-[12px] bg-gray-100 px-1.5 py-0.5 rounded">/login</code>{' '}
          with the email and password you set here, and will land on a
          restricted dashboard (Bookings + Workers, no revenue figures).
        </p>
      </div>

      {/* ── Create form ── */}
      <form onSubmit={createAssistant} className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
        <p className="text-xs font-black uppercase tracking-wide text-gray-400">New assistant</p>

        <div>
          <label className="text-[11px] font-bold text-gray-500 mb-1 block">Full name</label>
          <input value={fullName} onChange={e => setFullName(e.target.value)}
            placeholder="e.g. Adwait Chavan"
            className="w-full px-3 py-2.5 rounded-xl text-sm border border-gray-200 outline-none focus:border-cyan-400" />
        </div>

        <div>
          <label className="text-[11px] font-bold text-gray-500 mb-1 block">Gmail / email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="assistant@gmail.com"
            className="w-full px-3 py-2.5 rounded-xl text-sm border border-gray-200 outline-none focus:border-cyan-400" />
        </div>

        <div>
          <label className="text-[11px] font-bold text-gray-500 mb-1 block">Password</label>
          <div className="relative">
            <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full px-3 py-2.5 rounded-xl text-sm border border-gray-200 outline-none focus:border-cyan-400 pr-16" />
            <button type="button" onClick={() => setShowPassword(s => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-bold text-cyan-600">
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        {formErr && (
          <div className="rounded-xl bg-red-50 border border-red-100 px-3 py-2.5 text-[13px] font-semibold text-red-700">
            {formErr}
          </div>
        )}
        {formOk && (
          <div className="rounded-xl bg-green-50 border border-green-100 px-3 py-2.5 text-[13px] font-semibold text-green-700">
            {formOk}
          </div>
        )}

        <button type="submit" disabled={creating}
          className="w-full py-3 rounded-xl font-black text-white text-sm disabled:opacity-50"
          style={{ background: '#0891B2' }}>
          {creating ? 'Creating…' : 'Create assistant login'}
        </button>
      </form>

      {/* ── Existing assistants ── */}
      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-5 py-3.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
          <p className="text-xs font-black uppercase tracking-wide text-gray-400">Existing assistants</p>
          <span className="text-[11px] font-bold text-gray-400">{assistants.length}</span>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">Loading…</div>
        ) : err ? (
          <div className="p-5 text-sm font-semibold text-red-600">{err}</div>
        ) : assistants.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">No assistants yet — create one above.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {assistants.map(a => (
              <div key={a.id} className="flex items-center justify-between px-5 py-3.5 gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">{a.full_name}</p>
                  <p className="text-[12px] text-gray-400 truncate">{a.email}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[10px] font-black px-2 py-1 rounded-full"
                    style={{
                      background: a.is_active ? '#DCFCE7' : '#FEE2E2',
                      color: a.is_active ? '#15803D' : '#B91C1C',
                    }}>
                    {a.is_active ? 'Active' : 'Blocked'}
                  </span>
                  <button onClick={() => toggleActive(a)} disabled={toggling === a.id}
                    className="text-[11px] font-black px-3 py-1.5 rounded-lg border disabled:opacity-50"
                    style={{
                      borderColor: a.is_active ? '#FCA5A5' : '#86EFAC',
                      color: a.is_active ? '#DC2626' : '#16A34A',
                    }}>
                    {toggling === a.id ? '…' : a.is_active ? 'Block' : 'Unblock'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}