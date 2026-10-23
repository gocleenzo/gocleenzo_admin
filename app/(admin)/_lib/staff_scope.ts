'use client'
// ─────────────────────────────────────────────────────────────────────
// Browser side of "assistants only see their own areas".
//
//  • loadStaffScope() / useStaffScope(): what the logged-in user may see
//    (owner = everything). Fails CLOSED: if it can't be loaded, an
//    assistant sees nothing rather than everything.
//  • staffRpc() / staffUpdateBooking() / staffAction(): every change goes
//    through /api/staff/action, which checks the areas on the server.
//    They return { data, error } exactly like supabase.rpc() does, so the
//    pages' existing error handling keeps working.
// ─────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'

export type StaffScope = {
  loaded: boolean
  role: 'owner' | 'assistant' | null
  all: boolean
  areas: string[]
  pincodes: Set<string>
  workerIds: Set<string>
}

const EMPTY: StaffScope = {
  loaded: false, role: null, all: false, areas: [], pincodes: new Set(), workerIds: new Set(),
}

let cached: Promise<StaffScope> | null = null

export function loadStaffScope(force = false): Promise<StaffScope> {
  if (!cached || force) {
    cached = fetch('/api/staff/scope', { cache: 'no-store' })
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j?.error ?? 'scope')
        return {
          loaded: true,
          role: j.role ?? null,
          all: j.all === true,
          areas: Array.isArray(j.areas) ? j.areas : [],
          pincodes: new Set<string>((j.pincodes ?? []).map((p: any) => String(p).trim())),
          workerIds: new Set<string>((j.worker_ids ?? []).map((w: any) => String(w))),
        } as StaffScope
      })
      .catch(() => {
        cached = null // try again next time
        return { ...EMPTY, loaded: true }
      })
  }
  return cached
}

export function useStaffScope(): StaffScope {
  const [s, setS] = useState<StaffScope>(EMPTY)
  useEffect(() => {
    let alive = true
    loadStaffScope().then(v => { if (alive) setS(v) })
    return () => { alive = false }
  }, [])
  return s
}

export function pinInScope(s: StaffScope, pincode: unknown): boolean {
  if (s.all) return true
  const p = String(pincode ?? '').trim()
  return !!p && s.pincodes.has(p)
}

export function workerInScope(s: StaffScope, workerId: unknown): boolean {
  if (s.all) return true
  const w = String(workerId ?? '')
  return !!w && s.workerIds.has(w)
}

type Result = { data: any; error: { message: string } | null }

export async function staffAction(payload: Record<string, any>): Promise<Result> {
  try {
    const res = await fetch('/api/staff/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const j = await res.json().catch(() => null)
    if (!j) return { data: null, error: { message: 'Could not reach the server. Please try again.' } }
    return { data: j.data ?? null, error: j.error ?? null }
  } catch (e: any) {
    return { data: null, error: { message: e?.message ?? 'Network error' } }
  }
}

/** Same as supabase.rpc(fn, args), but checked against your areas. */
export function staffRpc(fn: string, args: Record<string, any>): Promise<Result> {
  return staffAction({ action: 'rpc', fn, args })
}

/** Same as supabase.from('bookings').update(patch).eq('id', id), but checked. */
export function staffUpdateBooking(bookingId: string, patch: Record<string, any>): Promise<Result> {
  return staffAction({ action: 'update_booking', booking_id: bookingId, patch })
}