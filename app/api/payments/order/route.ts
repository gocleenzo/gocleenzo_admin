import Razorpay from 'razorpay'
import { NextRequest, NextResponse } from 'next/server'

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Flutter sends amount already in paise (₹500 → 50000)
    // So we use it directly — do NOT multiply by 100 again
    const amount: number  = body.amount
    const currency: string = body.currency ?? 'INR'
    const receipt: string  = body.receipt  ?? `receipt_${Date.now()}`

    // ── notes: REQUIRED for the payment webhook to work at all ──────
    // notes.type tells /api/payments/webhook which recovery path to
    // run ('booking' | 'recurring_package' | 'extra_time'). Without
    // an order (and without notes on that order), Razorpay's
    // payment.captured event has no order_id at all — the webhook's
    // very first check (`if (!paymentId || !orderId)`) fails and the
    // payment is silently un-recoverable if the client's own
    // post-payment code never runs (app killed/backgrounded/network
    // drop right after Razorpay captures the money). This is what
    // was happening to extra-time payments before this fix — the
    // Flutter app opened Razorpay checkout with no order_id at all,
    // so there was nothing for the webhook to hang a recovery off of.
    //
    // Callers should always pass a notes object, e.g.:
    //   { type: 'extra_time', booking_id: '...' }
    //   { type: 'recurring_package', ... }
    // If omitted, this falls back to an empty object rather than
    // failing the request — but the webhook will then default to
    // treating it as a normal 'booking', which is only correct for
    // the actual new-booking flow.
    const notes: Record<string, string> = body.notes ?? {}

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }

    // Razorpay hard-caps `receipt` at 40 characters — anything longer
    // is REJECTED by their API (order creation fails outright, which
    // surfaced to the client only as a generic "Failed to create
    // order" 500 before this fix logged the real reason below). A
    // caller-built receipt like `extra_time_<uuid>_<timestamp>` is
    // ~62 chars, well over the limit, so it's truncated here as a
    // safety net regardless of what any caller sends.
    const safeReceipt = receipt.slice(0, 40)

    const order = await razorpay.orders.create({
      amount,   // already in paise
      currency,
      receipt: safeReceipt,
      notes,
    })

    // Flutter expects the key "order_id" (not "orderId")
    return NextResponse.json({ order_id: order.id, amount: order.amount })
  } catch (err: any) {
    // Razorpay SDK errors carry the actual reason in err.error (e.g.
    // { code, description, field }) — log that specifically, not just
    // the generic error object, so failures like this are diagnosable
    // from Vercel logs instead of only ever showing a bare 500 to the
    // client.
    console.error('Razorpay order error:', err?.error ?? err)
    return NextResponse.json(
      { error: 'Failed to create order', detail: err?.error?.description ?? String(err) },
      { status: 500 }
    )
  }
}