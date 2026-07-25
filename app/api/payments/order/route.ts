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

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }

    const order = await razorpay.orders.create({
      amount,   // already in paise
      currency,
      receipt,
    })

    // Flutter expects the key "order_id" (not "orderId")
    return NextResponse.json({ order_id: order.id, amount: order.amount })
  } catch (err) {
    console.error('Razorpay order error:', err)
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 })
  }
}