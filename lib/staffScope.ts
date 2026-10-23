// ─────────────────────────────────────────────────────────────────────
// Which part of Cleenzo a logged-in admin user may work with.
//
//   owner      → everything
//   assistant  → only the areas ticked for them on the Assistants page
//                (bookings at those pincodes, workers who cover them).
//
// Used by every server route an assistant can call, so the limit is
// enforced on the server, not just hidden on screen.
// ─────────────────────────────────────────────────────────────────────
import { NextRequest } from 'next/server'
import { verifyAdminSession, type AdminSession } from '@/lib/adminAuth'
import { createServiceClient } from '@/lib/supabase/admin'

export type StaffScope = {
  session: AdminSession
  all: boolean               // true for the owner
  areas: string[]
  pincodes: Set<string>
  workerIds: Set<string>
}

export async function staffSession(req: NextRequest): Promise<AdminSession | null> {
  const token = req.cookies.get('admin_session')?.value
  return token ? await verifyAdminSession(token) : null
}

const clean = (v: unknown) => String(v ?? '').trim()

/** The scope for a session. An assistant with no areas gets an empty scope. */
export async function scopeFor(session: AdminSession): Promise<StaffScope> {
  if (session.role === 'owner') {
    return { session, all: true, areas: [], pincodes: new Set(), workerIds: new Set() }
  }
  const db = createServiceClient()
  const [{ data: areaRows }, { data: pinRows }] = await Promise.all([
    db.from('assistant_areas').select('area_name').eq('admin_user_id', session.id),
    db.rpc('staff_pincodes', { p_admin: session.id }),
  ])
  const areas = (areaRows ?? []).map((r: any) => clean(r.area_name)).filter(Boolean)
  const pincodes = new Set<string>(
    ((pinRows ?? []) as any[]).map(r => clean(typeof r === 'string' ? r : r.staff_pincodes ?? Object.values(r)[0])).filter(Boolean))

  const workerIds = new Set<string>()
  if (pincodes.size > 0) {
    const pins = Array.from(pincodes)
    const [{ data: wp }, { data: zones }] = await Promise.all([
      db.from('worker_pincodes').select('worker_id').in('pincode', pins),
      db.from('service_zones').select('id').in('pincode', pins),
    ])
    ;(wp ?? []).forEach((r: any) => r.worker_id && workerIds.add(String(r.worker_id)))
    const zoneIds = (zones ?? []).map((z: any) => z.id)
    if (zoneIds.length > 0) {
      const { data: zw } = await db.from('zone_workers').select('worker_id').in('zone_id', zoneIds)
      ;(zw ?? []).forEach((r: any) => r.worker_id && workerIds.add(String(r.worker_id)))
    }
  }
  return { session, all: false, areas, pincodes, workerIds }
}

/** Session + scope from a request, or null if not logged in. */
export async function requestScope(req: NextRequest): Promise<StaffScope | null> {
  const s = await staffSession(req)
  return s ? await scopeFor(s) : null
}

export function pincodeAllowed(scope: StaffScope, pincode: unknown): boolean {
  if (scope.all) return true
  const p = clean(pincode)
  return !!p && scope.pincodes.has(p)
}

export function workerAllowed(scope: StaffScope, workerId: unknown): boolean {
  if (scope.all) return true
  const w = clean(workerId)
  return !!w && scope.workerIds.has(w)
}

/** Pincode of a booking's address ('' if none). */
export async function bookingPincode(bookingId: string): Promise<string> {
  const db = createServiceClient()
  const { data } = await db.from('bookings')
    .select('id, addresses(pincode)').eq('id', bookingId).maybeSingle()
  const a: any = (data as any)?.addresses
  return clean(Array.isArray(a) ? a[0]?.pincode : a?.pincode)
}

export async function bookingAllowed(scope: StaffScope, bookingId: unknown): Promise<boolean> {
  if (scope.all) return true
  const id = clean(bookingId)
  if (!id) return false
  return pincodeAllowed(scope, await bookingPincode(id))
}

export const OUTSIDE_AREA = 'This is outside your areas. Ask the owner if you need access.'