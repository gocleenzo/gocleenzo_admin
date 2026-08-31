'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

// ============================================================================
// Admin Notifications page
// ============================================================================
// Compose a title/body, pick an audience (all customers / an area by
// pincode / one specific user), and pick a send time (now, or any future
// time). Creates a row in scheduled_notifications — actual sending
// happens server-side via /api/notifications/dispatch, triggered
// periodically (see that route's header comment for cron setup). This
// page also lists the queue (pending/sent/failed/cancelled) so an admin
// can queue multiple notifications and track them.
// ============================================================================

type Notif = {
  id: string
  title: string
  body: string
  target_type: 'all' | 'area' | 'user'
  target_value: string | null
  send_at: string
  status: 'pending' | 'sent' | 'failed' | 'cancelled'
  recipients_count: number | null
  error: string | null
  created_at: string
  sent_at: string | null
}

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  pending:   { bg: '#FEF3C7', fg: '#B45309', label: '⏳ Pending' },
  sent:      { bg: '#D1FAE5', fg: '#059669', label: '✓ Sent' },
  failed:    { bg: '#FEE2E2', fg: '#DC2626', label: '✕ Failed' },
  cancelled: { bg: '#F1F5F9', fg: '#64748B', label: '— Cancelled' },
}

export default function AdminNotificationsPage() {
  const supabase = createClient()

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [targetType, setTargetType] = useState<'all' | 'area' | 'user'>('all')
  const [pincode, setPincode] = useState('')
  const [userQuery, setUserQuery] = useState('')
  const [userResults, setUserResults] = useState<{ id: string; full_name: string; phone: string }[]>([])
  const [selectedUser, setSelectedUser] = useState<{ id: string; full_name: string } | null>(null)
  const [sendNow, setSendNow] = useState(true)
  const [sendAt, setSendAt] = useState(toDatetimeLocalValue(new Date(Date.now() + 5 * 60000)))
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [notifs, setNotifs] = useState<Notif[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/schedule')
      const json = await res.json()
      setNotifs(json.notifications ?? [])
    } catch (e) {
      console.error('Load notifications error:', e)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 20s so sent/failed statuses update without a
  // manual reload — dispatch runs server-side on its own schedule.
  useEffect(() => {
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    if (targetType !== 'user' || userQuery.trim().length < 2) {
      setUserResults([])
      return
    }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('users')
        .select('id, full_name, phone')
        .eq('role', 'customer')
        .or(`full_name.ilike.%${userQuery}%,phone.ilike.%${userQuery}%`)
        .limit(8)
      setUserResults((data ?? []) as any)
    }, 300)
    return () => clearTimeout(t)
  }, [userQuery, targetType, supabase])

  async function submit() {
    setFormError(null)
    if (!title.trim() || !body.trim()) {
      setFormError('Title and message are both required'); return
    }
    if (targetType === 'area' && !pincode.trim()) {
      setFormError('Enter a pincode for area targeting'); return
    }
    if (targetType === 'user' && !selectedUser) {
      setFormError('Search and select a customer'); return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/notifications/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          target_type: targetType,
          target_value: targetType === 'area' ? pincode.trim()
                       : targetType === 'user' ? selectedUser?.id
                       : null,
          send_at: sendNow ? new Date().toISOString() : new Date(sendAt).toISOString(),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not schedule notification')

      // Reset form for the next one — queuing multiple is a core part
      // of this feature, so clearing (not navigating away) matters.
      setTitle(''); setBody(''); setPincode('')
      setUserQuery(''); setSelectedUser(null); setUserResults([])
      setSendNow(true); setSendAt(toDatetimeLocalValue(new Date(Date.now() + 5 * 60000)))
      load()
    } catch (e: any) {
      setFormError(e.message)
    }
    setSaving(false)
  }

  async function cancelNotif(id: string) {
    if (!confirm('Cancel this scheduled notification? It has not been sent yet.')) return
    try {
      const res = await fetch(`/api/notifications/schedule?id=${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json()
        throw new Error(j.error ?? 'Could not cancel')
      }
      load()
    } catch (e: any) {
      alert(e.message)
    }
  }

  return (
    <div className="min-h-screen px-4 md:px-8 py-7 bg-slate-50">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl"
          style={{ background: '#0891B214', border: '1px solid #0891B225' }}>🔔</div>
        <div>
          <h1 className="text-2xl font-black text-slate-900 leading-tight tracking-tight">Notifications</h1>
          <p className="text-xs text-slate-400 font-medium">Compose and schedule push notifications to customers</p>
        </div>
      </div>

      {/* ── Compose form ── */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 mb-6">
        <p className="text-[11px] font-black text-slate-400 uppercase tracking-wide mb-3">New Notification</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-[11px] font-bold text-slate-500 mb-1.5 block">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Weekend Offer!"
              className="w-full h-10 px-3 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-500 mb-1.5 block">Message</label>
            <input value={body} onChange={e => setBody(e.target.value)}
              placeholder="e.g. Get 20% off this weekend"
              className="w-full h-10 px-3 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200" />
          </div>
        </div>

        <div className="mb-4">
          <label className="text-[11px] font-bold text-slate-500 mb-1.5 block">Send To</label>
          <div className="flex gap-2 flex-wrap">
            {(['all', 'area', 'user'] as const).map(t => (
              <button key={t} onClick={() => setTargetType(t)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                style={{
                  background: targetType === t ? '#CFFAFE' : '#fff',
                  color: targetType === t ? '#0891B2' : '#64748B',
                  border: `1px solid ${targetType === t ? '#0891B2' : '#E2E8F0'}`,
                }}>
                {t === 'all' ? 'All Customers' : t === 'area' ? 'By Area (Pincode)' : 'Specific Customer'}
              </button>
            ))}
          </div>

          {targetType === 'area' && (
            <input value={pincode} onChange={e => setPincode(e.target.value)}
              placeholder="Pincode, e.g. 400057"
              className="mt-2 w-full max-w-xs h-10 px-3 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200" />
          )}

          {targetType === 'user' && (
            <div className="mt-2 max-w-sm relative">
              {selectedUser ? (
                <div className="flex items-center justify-between px-3 h-10 rounded-xl bg-cyan-50 border border-cyan-200">
                  <span className="text-sm font-bold text-cyan-800">{selectedUser.full_name}</span>
                  <button onClick={() => { setSelectedUser(null); setUserQuery('') }}
                    className="text-cyan-600 text-xs font-bold">Change</button>
                </div>
              ) : (
                <>
                  <input value={userQuery} onChange={e => setUserQuery(e.target.value)}
                    placeholder="Search by name or phone…"
                    className="w-full h-10 px-3 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200" />
                  {userResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden">
                      {userResults.map(u => (
                        <button key={u.id}
                          onClick={() => { setSelectedUser(u); setUserResults([]) }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-50 last:border-0">
                          <span className="font-bold text-slate-800">{u.full_name}</span>
                          <span className="text-slate-400 ml-2 text-xs">{u.phone}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="mb-4">
          <label className="text-[11px] font-bold text-slate-500 mb-1.5 block">When</label>
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => setSendNow(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
              style={{
                background: sendNow ? '#CFFAFE' : '#fff',
                color: sendNow ? '#0891B2' : '#64748B',
                border: `1px solid ${sendNow ? '#0891B2' : '#E2E8F0'}`,
              }}>
              Send Now
            </button>
            <button onClick={() => setSendNow(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
              style={{
                background: !sendNow ? '#CFFAFE' : '#fff',
                color: !sendNow ? '#0891B2' : '#64748B',
                border: `1px solid ${!sendNow ? '#0891B2' : '#E2E8F0'}`,
              }}>
              Schedule for Later
            </button>
            {!sendNow && (
              <input type="datetime-local" value={sendAt}
                onChange={e => setSendAt(e.target.value)}
                className="h-9 px-3 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200" />
            )}
          </div>
        </div>

        {formError && (
          <div className="mb-4 rounded-xl px-4 py-2.5 bg-red-50 border border-red-200">
            <p className="text-xs font-bold text-red-600">{formError}</p>
          </div>
        )}

        <button onClick={submit} disabled={saving}
          className="h-11 px-6 rounded-xl font-black text-sm text-white disabled:opacity-50 active:scale-[0.98] transition-all"
          style={{ background: 'linear-gradient(135deg,#0891B2,#4F46E5)' }}>
          {saving ? 'Saving…' : sendNow ? '📤 Queue for Immediate Send' : '🗓️ Schedule Notification'}
        </button>
        <p className="text-[11px] text-slate-400 mt-2">
          {sendNow
            ? 'Sends on the next dispatch run (typically within a minute).'
            : 'Will send automatically at the chosen time — you can add more notifications while this one waits.'}
        </p>
      </div>

      {/* ── Queue ── */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <p className="font-bold text-slate-800 text-sm">Queue</p>
          <p className="text-[11px] text-slate-400">{notifs.length} notification{notifs.length === 1 ? '' : 's'}</p>
        </div>

        {loading ? (
          <div className="p-8 space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-slate-100 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : notifs.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-3xl mb-2">🔔</p>
            <p className="text-slate-500 text-sm">No notifications yet</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {notifs.map(n => {
              const s = STATUS_STYLE[n.status]
              return (
                <div key={n.id} className="px-5 py-4 flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="font-bold text-slate-800 text-sm">{n.title}</p>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: s.bg, color: s.fg }}>{s.label}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                        {n.target_type === 'all' ? 'All Customers'
                          : n.target_type === 'area' ? `Area ${n.target_value}`
                          : 'Specific Customer'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mb-1">{n.body}</p>
                    <p className="text-[11px] text-slate-400">
                      {n.status === 'sent'
                        ? `Sent ${new Date(n.sent_at!).toLocaleString('en-IN')} · ${n.recipients_count ?? 0} recipient${(n.recipients_count ?? 0) === 1 ? '' : 's'}`
                        : n.status === 'failed'
                        ? `Failed: ${n.error ?? 'Unknown error'}`
                        : `Scheduled for ${new Date(n.send_at).toLocaleString('en-IN')}`}
                    </p>
                  </div>
                  {n.status === 'pending' && (
                    <button onClick={() => cancelNotif(n.id)}
                      className="flex-shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-all">
                      Cancel
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}