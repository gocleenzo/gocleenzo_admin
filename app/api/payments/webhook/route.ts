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
// BEFORE it finishes verifying + calling try_claim_slot -> money taken,
// no booking, no refund, because all of that follow-up logic previously
// lived only inside the app's own post-payment code path.
//
// Flow:
//   1. Verify this request genuinely came from Razorpay (HMAC signature
//      over the RAW request body, using a separate Webhook Secret — NOT
//      the same as RAZORPAY_KEY_SECRET used for order/payment API calls).
//   2. On a payment.captured event, look up which booking ATTEMPT this
//      payment belongs to (via the order's `receipt`, which the app
//      already sets to its `attempt_ref` when creating the order).
//   3. Ask the database (complete_payment_booking_recovery) what to do:
//        - 'already_completed' -> app finished normally, nothing to do.
//        - 'booking_created'   -> the app never finished; this webhook
//                                  just completed the booking on its
//                                  behalf, using the same try_claim_slot
//                                  every other booking path already uses.
//        - 'needs_refund'      -> the slot was genuinely gone by the time
//                                  we could check; refund the payment here.
//        - 'no_draft_found'    -> nothing saved for this attempt (e.g. an
//                                  extra-time payment, which doesn't use
//                                  this table at all) — ignore.
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
//      This route needs it to call the recovery RPC and, if needed,
//      update pending_payment_bookings directly — both of which must
//      bypass normal customer RLS, since no customer is making this call.
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
    console.error('Webhook: payment.captured event missing payment id or order id', payload)
    return NextResponse.json({ received: true, error: 'Malformed payload' })
  }

  try {
    // The order's `receipt` field is exactly the `attempt_ref` the app
    // set when it originally created this order — this is how we find
    // which booking attempt this payment belongs to, without needing to
    // add anything extra to the order-creation call itself.
    const order = await razorpay.orders.fetch(orderId)
    const attemptRef = order.receipt

    if (!attemptRef) {
      console.warn(`Webhook: order ${orderId} has no receipt/attempt_ref — nothing to recover`)
      return NextResponse.json({ received: true, action: 'no_attempt_ref' })
    }

    const supabase = supabaseAdmin()

    // The order's notes carry a `type` field set by the client at
    // checkout — 'recurring_package' for the weekly-package flow,
    // absent/other for a normal single booking. This determines which
    // recovery function and which pending-draft table to check.
    const orderType = (order.notes?.type as string | undefined) ?? 'booking'

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