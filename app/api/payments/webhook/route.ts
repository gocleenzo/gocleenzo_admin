import crypto from 'crypto'
import Razorpay from 'razorpay'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// ============================================================================
// POST /api/payments/webhook
// ============================================================================
// Razorpay calls this endpoint DIRECTLY, server-to-server, the moment a
// payment is captured — completely independent of whether the customer's
// phone/app is even on. This is the fix for: customer pays, app gets
// killed/backgrounded/loses network right after payment succeeds but
// BEFORE it finishes its own post-payment update -> money taken, nothing
// in the DB reflects it, because that follow-up logic previously lived
// only inside the app's own post-payment code path.
//
// Flow:
//   1. Verify this request genuinely came from Razorpay (HMAC signature
//      over the RAW request body, using a separate Webhook Secret — NOT
//      the same as RAZORPAY_KEY_SECRET used for order/payment API calls).
//   2. On a payment.captured event, figure out which booking ATTEMPT this
//      payment belongs to and what TYPE of payment it was. TWO possible
//      sources for that, checked in order:
//        a) payment.entity.notes — set directly when the payment
//           originated from a PAYMENT LINK (see /api/payments/payment-link),
//           since Razorpay attaches the link's notes straight onto the
//           resulting payment object. This is the "someone else, on a
//           different phone, paid via a Razorpay-hosted link" path.
//        b) order.notes / order.receipt — the ORIGINAL path, for payments
//           made through the in-app Razorpay checkout SDK, where the app
//           itself created the order first via /api/payments/order and
//           set notes.type + receipt=attempt_ref on it directly.
//      Both paths converge on the exact same `type` + `attempt_ref` /
//      `booking_id` shape, so everything downstream (which recovery RPC
//      to call, refund-on-failure, etc.) is IDENTICAL regardless of which
//      device/flow the money actually came from.
//   3. Route to the matching recovery function:
//        - 'booking'          -> complete_payment_booking_recovery
//        - 'recurring_package'-> complete_recurring_package_recovery
//        - 'extra_time'       -> complete_extra_time_payment_recovery
//      Each is idempotent and re-checks current status before doing
//      anything, so retries (Razorpay resends on non-2xx, or a race
//      against the client's own update) can never double-apply.
//
// IMPORTANT SETUP STEPS (do these once, outside of code):
//   a) In Razorpay Dashboard -> Settings -> Webhooks, add a webhook
//      pointing to https://gocleenzo-admin.vercel.app/api/payments/webhook
//      and select BOTH the "payment.captured" event AND the
//      "payment_link.paid" event — a payment made via a Payment Link
//      still fires payment.captured too, but enabling payment_link.paid
//      as well is a safe, harmless belt-and-suspenders addition (this
//      handler treats both event names identically, see below).
//   b) Razorpay will show you a Webhook Secret when you create it — set
//      that value as RAZORPAY_WEBHOOK_SECRET in your environment (this is
//      DIFFERENT from RAZORPAY_KEY_SECRET already used elsewhere).
//   c) Add SUPABASE_SERVICE_ROLE_KEY to your environment (found in
//      Supabase Dashboard -> Project Settings -> API -> service_role key).
//      This route needs it to call the recovery RPCs and, if needed,
//      update pending_payment_bookings directly — both of which must
//      bypass normal customer RLS, since no customer is making this call.
//   d) EVERY client-side flow that opens Razorpay checkout MUST first
//      call POST /api/payments/order to get a real order_id, and pass
//      `notes: { type: '...' }` on that call — checkout options with no
//      order_id produce a payment.captured event with no order_id
//      either, which this webhook cannot recover (see the `!orderId`
//      check below). "Orderless" checkout (amount-only, no order_id)
//      is what caused extra-time payments to be unrecoverable before
//      this was fixed — always create a real order first. Payment
//      Links are exempt from this — Razorpay auto-creates the
//      underlying order for you when a link is created.
// ============================================================================

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
})

function supabaseAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function POST(req: NextRequest) {
  // Read the RAW body text first — signature verification is sensitive to
  // exact bytes/whitespace, so this must happen before any JSON parsing.
  const rawBody = await req.text()

  const signature = req.headers.get('x-razorpay-signature')
  if (!signature) {
    console.warn('Webhook: missing x-razorpay-signature header')
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!)
    .update(rawBody)
    .digest('hex')

  if (expectedSignature !== signature) {
    console.warn('Webhook: signature mismatch — request did not genuinely come from Razorpay')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch (err) {
    console.error('Webhook: could not parse body as JSON', err)
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Accept both event names — a Payment Link payment fires
  // 'payment_link.paid' in addition to the normal 'payment.captured', and
  // in both cases the actual payment entity lives at the same
  // payload.payload.payment.entity path. Everything else this endpoint
  // might receive (order.paid, refund.processed, etc., depending on what
  // else is selected in the dashboard) is ignored.
  if (payload?.event !== 'payment.captured' && payload?.event !== 'payment_link.paid') {
    return NextResponse.json({ received: true, ignored: true })
  }

  const payment = payload?.payload?.payment?.entity
  const paymentId: string | undefined = payment?.id
  const orderId:   string | undefined = payment?.order_id

  if (!paymentId || !orderId) {
    // See setup note (d) above — this means whatever screen triggered
    // this payment opened Razorpay checkout WITHOUT first creating a
    // real order via /api/payments/order (or, for a Payment Link, that
    // Razorpay somehow didn't attach an order_id, which shouldn't
    // normally happen). There is nothing this webhook can recover
    // without an order_id to look notes/receipt up on.
    console.error('Webhook: payment event missing payment id or order id', payload)
    return NextResponse.json({ received: true, error: 'Malformed payload' })
  }

  try {
    const supabase = supabaseAdmin()

    // ── Identify this payment: Payment Link notes first, order second ──
    // A Payment-Link-originated payment carries its own notes directly on
    // the PAYMENT object (set at link-creation time in
    // /api/payments/payment-link) — checking that first means we often
    // don't even need to fetch the order at all for that path. Normal
    // in-app checkout payments have no useful notes on the payment
    // itself, so this falls through to fetching the order exactly as
    // before.
    const paymentNotes = (payment?.notes ?? {}) as Record<string, string>
    let orderType   = paymentNotes.type as string | undefined
    let attemptRef  = paymentNotes.attempt_ref as string | undefined
    let bookingIdFromNotes = paymentNotes.booking_id as string | undefined

    if (!orderType) {
      const order = await razorpay.orders.fetch(orderId)
      orderType = (order.notes?.type as string | undefined) ?? 'booking'
      attemptRef = attemptRef ?? (order.receipt as string | undefined)
      bookingIdFromNotes = bookingIdFromNotes ?? (order.notes?.booking_id as string | undefined)
    }

    if (orderType === 'extra_time') {
      // Extra-time payments don't use the pending_payment_bookings
      // draft-table pattern the other two flows do — the booking
      // ALREADY EXISTS (it's mid-service), we're just confirming its
      // extra-time fields. Identified by booking_id, set either in the
      // order's notes (in-app checkout) or the payment's notes (payment
      // link) — see BookingDetailScreen._startExtraTimePayment and
      // _sendExtraTimePaymentLink respectively.
      const bookingId = bookingIdFromNotes

      if (!bookingId) {
        console.warn(`Webhook: extra_time payment ${paymentId} has no booking_id in notes — nothing to recover`)
        return NextResponse.json({ received: true, action: 'no_booking_id' })
      }

      const { data: result, error: rpcError } = await supabase.rpc(
        'complete_extra_time_payment_recovery',
        { p_booking_id: bookingId, p_payment_id: paymentId }
      )

      if (rpcError) {
        console.error('Webhook: complete_extra_time_payment_recovery RPC error', rpcError)
        // 500 -> Razorpay retries later. Safe: the RPC re-checks
        // status before writing anything.
        return NextResponse.json({ error: 'Recovery RPC failed' }, { status: 500 })
      }

      console.log(`Webhook: extra_time recovery for booking_id=${bookingId}:`, result)
      return NextResponse.json({ received: true, action: result?.action })
    }

    // ── 'booking' / 'recurring_package' — attempt_ref flow ──
    // attempt_ref is either straight from the payment's own notes
    // (payment link) or the order's receipt field (in-app checkout,
    // where the app set receipt=attempt_ref when creating the order).
    if (!attemptRef) {
      console.warn(`Webhook: payment ${paymentId} (order ${orderId}) has no attempt_ref — nothing to recover`)
      return NextResponse.json({ received: true, action: 'no_attempt_ref' })
    }

    const { data: result, error: rpcError } = orderType === 'recurring_package'
      ? await supabase.rpc('complete_recurring_package_recovery', {
          p_attempt_ref: attemptRef, p_payment_id: paymentId,
        })
      : await supabase.rpc('complete_payment_booking_recovery', {
          p_attempt_ref: attemptRef, p_payment_id: paymentId,
        })

    if (rpcError) {
      console.error('Webhook: complete_payment_booking_recovery RPC error', rpcError)
      // 500 here DOES cause Razorpay to retry this webhook later, which
      // is actually what we want if it was a transient DB issue — the
      // recovery attempt itself is safely re-runnable (it re-checks
      // status before doing anything, so retries can't double-book).
      return NextResponse.json({ error: 'Recovery RPC failed' }, { status: 500 })
    }

    console.log(`Webhook: recovery action for attempt_ref=${attemptRef}:`, result)

    if (result?.action === 'needs_refund') {
      try {
        const refund = await razorpay.payments.refund(paymentId, {
          notes: {
            reason: `auto_recovery: ${result.reason ?? 'slot_unavailable'}`,
          },
          speed: 'optimum',
        })
        console.log(`Webhook: auto-refunded payment ${paymentId} -> refund ${refund.id}`)
      } catch (refundErr: any) {
        console.error('Webhook: auto-refund failed', refundErr)
        // The booking recovery already correctly marked this
        // 'failed_refunded' in the DB even though the actual Razorpay
        // refund call itself just failed here — flag it distinctly so
        // it surfaces for manual follow-up rather than being mistaken
        // for an already-completed refund.
        await supabase
          .from(orderType === 'recurring_package' ? 'pending_recurring_packages' : 'pending_payment_bookings')
          .update({ status: 'refund_error', updated_at: new Date().toISOString() })
          .eq('attempt_ref', attemptRef)
      }
    }

    return NextResponse.json({ received: true, action: result?.action })
  } catch (err) {
    console.error('Webhook: unexpected error', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}