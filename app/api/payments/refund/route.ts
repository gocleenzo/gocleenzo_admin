import Razorpay from 'razorpay'
import { NextRequest, NextResponse } from 'next/server'

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
})

// Called from the Flutter app whenever a payment succeeded but no booking
// resulted — e.g. the slot was taken by someone else in the moments
// between payment and try_claim_slot, or booking creation itself errored.
// Full refund only (no partial-refund use case here); idempotent on
// Razorpay's side if called twice for the same payment_id.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const paymentId: string | undefined = body.payment_id
    const reason: string = body.reason ?? 'unspecified'

    if (!paymentId) {
      return NextResponse.json(
        { refunded: false, error: 'Missing payment_id' },
        { status: 400 }
      )
    }

    const refund = await razorpay.payments.refund(paymentId, {
      // Omitting `amount` refunds the full captured amount — correct here
      // since these are always full-value bookings, never partial charges.
      notes: { reason },
      speed: 'optimum',
    })

    return NextResponse.json({
      refunded: true,
      refund_id: refund.id,
      status: refund.status,
    })
  } catch (err: any) {
    console.error('Razorpay refund error:', err)
    // Surface Razorpay's own error description when available (e.g.
    // "payment already refunded", "payment not captured yet") so the
    // Flutter app's fallback support message can be more specific if needed.
    const description = err?.error?.description ?? 'Refund failed'
    return NextResponse.json(
      { refunded: false, error: description },
      { status: 500 }
    )
  }
}