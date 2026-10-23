// POST /api/staff/action — every change the Bookings / Complaints pages
// make goes through here, so an assistant can only change things in their
// own areas. The owner can do everything (same as before).
//
// { action: 'rpc', fn, args }              one of the booking functions below
// { action: 'update_booking', booking_id, patch }
// { action: 'update_complaint', id, status }
// { action: 'update_review', id, status }
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'
import {
  requestScope, pincodeAllowed, workerAllowed, bookingAllowed, OUTSIDE_AREA, type StaffScope,
} from '@/lib/staffScope'

export const dynamic = 'force-dynamic'

type Check = (scope: StaffScope, args: any) => Promise<boolean>

// Booking functions the admin pages call, and how each is checked.
const RPCS: Record<string, Check> = {
  admin_create_manual_booking: async (s, a) => pincodeAllowed(s, a?.p_pincode),
  admin_create_recurring_package: async (s, a) => pincodeAllowed(s, a?.p_pincode),
  admin_edit_manual_booking: async (s, a) =>
    (await bookingAllowed(s, a?.p_booking_id)) && pincodeAllowed(s, a?.p_pincode),
  admin_reschedule_booking: async (s, a) => bookingAllowed(s, a?.p_booking_id),
  admin_block_slot: async (s, a) => workerAllowed(s, a?.p_worker_id),
}

// Booking columns the pages are allowed to change directly.
const BOOKING_FIELDS = new Set([
  'status', 'work_started_at', 'work_ended_at', 'payment_status', 'work_duration_seconds', 'scheduled_at',
])
const BOOKING_STATUSES = new Set(['pending', 'accepted', 'otp_verified', 'in_progress', 'completed', 'cancelled'])
const COMPLAINT_STATUSES = new Set(['open', 'in_progress', 'resolved', 'closed'])
const REVIEW_STATUSES = new Set(['published', 'featured', 'hidden'])

const deny = () => NextResponse.json({ data: null, error: { message: OUTSIDE_AREA } }, { status: 403 })
const bad = (m: string) => NextResponse.json({ data: null, error: { message: m } }, { status: 400 })
const ok = (data: any) => NextResponse.json({ data, error: null })
const fail = (m: string) => NextResponse.json({ data: null, error: { message: m } }, { status: 500 })

export async function POST(req: NextRequest) {
  const scope = await requestScope(req)
  if (!scope) return NextResponse.json({ data: null, error: { message: 'Please log in again.' } }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const db = createServiceClient()

  switch (body?.action) {
    case 'rpc': {
      const fn = String(body?.fn ?? '')
      const check = RPCS[fn]
      if (!check) return bad('This action is not allowed.')
      const args = body?.args && typeof body.args === 'object' ? body.args : {}
      if (!(await check(scope, args))) return deny()
      const { data, error } = await db.rpc(fn, args)
      if (error) return NextResponse.json({ data: null, error: { message: error.message } }, { status: 400 })
      return ok(data)
    }

    case 'update_booking': {
      const id = String(body?.booking_id ?? '')
      if (!/^[0-9a-f-]{36}$/i.test(id)) return bad('Booking not found.')
      const patch: Record<string, any> = {}
      for (const [k, v] of Object.entries(body?.patch ?? {})) {
        if (BOOKING_FIELDS.has(k)) patch[k] = v
      }
      if (patch.status !== undefined && !BOOKING_STATUSES.has(patch.status)) return bad('Unknown status.')
      if (Object.keys(patch).length === 0) return bad('Nothing to change.')
      if (!(await bookingAllowed(scope, id))) return deny()
      const { error } = await db.from('bookings').update(patch).eq('id', id)
      return error ? fail(error.message) : ok({ success: true })
    }

    case 'update_complaint': {
      const id = String(body?.id ?? '')
      const status = String(body?.status ?? '')
      if (!id || !COMPLAINT_STATUSES.has(status)) return bad('Unknown status.')
      if (!scope.all) {
        const { data: row } = await db.from('support_queries').select('*').eq('id', id).maybeSingle()
        if (!row) return bad('Not found.')
        const r: any = row
        const allowed =
          (r.booking_id && await bookingAllowed(scope, r.booking_id)) ||
          workerAllowed(scope, r.worker_id) ||
          workerAllowed(scope, r.user_id)
        if (!allowed) return deny()
      }
      const { error } = await db.from('support_queries').update({ status }).eq('id', id)
      return error ? fail(error.message) : ok({ success: true })
    }

    case 'update_review': {
      const id = String(body?.id ?? '')
      const status = String(body?.status ?? '')
      if (!id || !REVIEW_STATUSES.has(status)) return bad('Unknown status.')
      if (!scope.all) {
        const { data: row } = await db.from('reviews').select('booking_id, worker_id').eq('id', id).maybeSingle()
        if (!row) return bad('Not found.')
        const allowed = (row.booking_id && await bookingAllowed(scope, row.booking_id)) ||
          workerAllowed(scope, row.worker_id)
        if (!allowed) return deny()
      }
      const { error } = await db.from('reviews').update({ status }).eq('id', id)
      return error ? fail(error.message) : ok({ success: true })
    }
  }
  return bad('Unknown action.')
}