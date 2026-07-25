import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = await req.json()

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json(
        { verified: false, error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Razorpay signature = HMAC-SHA256 of "order_id|payment_id" using key_secret
    const body     = `${razorpay_order_id}|${razorpay_payment_id}`
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
      .update(body)
      .digest('hex')

    const isValid = expected === razorpay_signature

    if (!isValid) {
      console.warn('Razorpay signature mismatch', { razorpay_order_id, razorpay_payment_id })
      return NextResponse.json({ verified: false, error: 'Invalid signature' }, { status: 400 })
    }

    return NextResponse.json({ verified: true, payment_id: razorpay_payment_id })
  } catch (err) {
    console.error('Razorpay verify error:', err)
    return NextResponse.json({ verified: false, error: 'Verification failed' }, { status: 500 })
  }
}