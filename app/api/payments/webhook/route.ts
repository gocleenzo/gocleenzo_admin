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
//   2. On a payment.captured event, look up which booking ATTEMPT this
//      payment belongs to (via the order's `receipt`, which the app
//      already sets to its `attempt_ref` when creating the order) AND
//      what TYPE of payment it was (via the order's `notes.type`, set
//      by whichever screen created the order).
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
//      and select the "payment.captured" event.
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
//      this was fixed — always create a real order first.
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

  // Only act on captured payments — ignore every other event type
  // (order.paid, refund.processed, etc.) that Razorpay may also send to
  // this same endpoint depending on what's selected in the dashboard.
  if (payload?.event !== 'payment.captured') {
    return NextResponse.json({ received: true, ignored: true })
  }

  const payment = payload?.payload?.payment?.entity
  const paymentId: string | undefined = payment?.id
  const orderId:   string | undefined = payment?.order_id

  if (!paymentId || !orderId) {
    // See setup note (d) above — this means whatever screen triggered
    // this payment opened Razorpay checkout WITHOUT first creating a
    // real order via /api/payments/order. There is nothing this
    // webhook can recover without an order_id to look notes/receipt
    // up on. Fix the client flow rather than this endpoint.
    console.error('Webhook: payment.captured event missing payment id or order id', payload)
    return NextResponse.json({ received: true, error: 'Malformed payload' })
  }

  try {
    const order = await razorpay.orders.fetch(orderId)

    // The order's notes carry a `type` field set by the client at
    // checkout — 'recurring_package' for the weekly-package flow,
    // 'extra_time' for an in-progress booking's extra-time add-on,
    // absent/other for a normal single booking. This determines which
    // recovery function (and which identifying field on the order) to use.
    const orderType = (order.notes?.type as string | undefined) ?? 'booking'

    const supabase = supabaseAdmin()

    if (orderType === 'extra_time') {
      // Extra-time payments don't use the pending_payment_bookings
      // draft-table pattern the other two flows do — the booking
      // ALREADY EXISTS (it's mid-service), we're just confirming its
      // extra-time fields. Identified by notes.booking_id, set by the
      // Flutter app when creating the order (see
      // BookingDetailScreen._startExtraTimePayment).
      const bookingId = order.notes?.booking_id as string | undefined

      if (!bookingId) {
        console.warn(`Webhook: extra_time order ${orderId} has no notes.booking_id — nothing to recover`)
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

    // ── 'booking' / 'recurring_package' — original attempt_ref flow ──
    // The order's `receipt` field is exactly the `attempt_ref` the app
    // set when it originally created this order — this is how we find
    // which booking attempt this payment belongs to, without needing to
    // add anything extra to the order-creation call itself.
    const attemptRef = order.receipt

    if (!attemptRef) {
      console.warn(`Webhook: order ${orderId} has no receipt/attempt_ref — nothing to recover`)
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