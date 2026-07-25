import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateOtp, sendBookingConfirmationSms } from '@/lib/otp'

type CartItem = {
  service_id: string
  quantity:   number
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const {
      // single-service (legacy)
      service_id,
      // multi-service cart
      cart_items,           // CartItem[]
      // common
      address_id,
      scheduled_at,
      special_instructions,
      promo_code,
    } = body

    if (!address_id || !scheduled_at) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const isCart = Array.isArray(cart_items) && cart_items.length > 0

    if (!isCart && !service_id) {
      return NextResponse.json({ error: 'Provide service_id or cart_items' }, { status: 400 })
    }

    /* ── Resolve items & prices ─────────────────────────────────── */
    type ResolvedItem = { service_id: string; quantity: number; unit_price: number; total_price: number; name: string }
    let resolvedItems: ResolvedItem[] = []
    let basePrice = 0

    if (isCart) {
      const ids = (cart_items as CartItem[]).map(i => i.service_id)
      const { data: services, error: sErr } = await supabase
        .from('services')
        .select('id, name, base_price')
        .in('id', ids)

      if (sErr || !services?.length)
        return NextResponse.json({ error: 'Services not found' }, { status: 404 })

      resolvedItems = (cart_items as CartItem[]).map(item => {
        const svc = services.find(s => s.id === item.service_id)!
        const qty = Math.max(1, item.quantity ?? 1)
        return {
          service_id:  svc.id,
          quantity:    qty,
          unit_price:  svc.base_price,
          total_price: svc.base_price * qty,
          name:        svc.name,
        }
      })
      basePrice = resolvedItems.reduce((s, i) => s + i.total_price, 0)
    } else {
      const { data: service } = await supabase
        .from('services')
        .select('id, name, base_price')
        .eq('id', service_id)
        .single()

      if (!service) return NextResponse.json({ error: 'Service not found' }, { status: 404 })

      resolvedItems = [{ service_id: service.id, quantity: 1, unit_price: service.base_price, total_price: service.base_price, name: service.name }]
      basePrice = service.base_price
    }

    /* ── Promo code ─────────────────────────────────────────────── */
    let discountAmount = 0
    let promoId: string | null = null

    if (promo_code) {
      const { data: promo } = await supabase
        .from('promo_codes')
        .select('*')
        .eq('code', promo_code.toUpperCase())
        .eq('is_active', true)
        .single()

      if (promo && promo.used_count < promo.max_uses) {
        discountAmount = promo.discount_type === 'flat'
          ? promo.discount_value
          : Math.min(
              (basePrice * promo.discount_value) / 100,
              promo.max_discount_amount ?? 9999
            )
        promoId = promo.id
        await supabase.from('promo_codes')
          .update({ used_count: promo.used_count + 1 })
          .eq('id', promo.id)
      }
    }

    const finalAmount = basePrice - discountAmount

    /* ── Create booking ─────────────────────────────────────────── */
    const otp          = generateOtp()
    const otpExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    // For cart orders service_id is null; for single orders it's set (backward compat)
    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .insert({
        customer_id:          user.id,
        service_id:           isCart ? null : service_id,
        address_id,
        scheduled_at,
        status:               'pending',
        base_price:           basePrice,
        discount_amount:      discountAmount,
        final_amount:         finalAmount,
        otp,
        otp_expires_at:       otpExpiresAt,
        payment_status:       'pending',
        promo_code_id:        promoId,
        special_instructions: special_instructions ?? null,
      })
      .select()
      .single()

    if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 })

    /* ── Insert booking_items ────────────────────────────────────── */
    const itemRows = resolvedItems.map(i => ({
      booking_id:  booking.id,
      service_id:  i.service_id,
      quantity:    i.quantity,
      unit_price:  i.unit_price,
      total_price: i.total_price,
    }))

    const { error: iErr } = await supabase.from('booking_items').insert(itemRows)
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 })

    /* ── SMS ────────────────────────────────────────────────────── */
    const { data: userData } = await supabase
      .from('users')
      .select('phone')
      .eq('id', user.id)
      .single()

    if (userData?.phone) {
      const label = isCart
        ? `${resolvedItems.length} services`
        : resolvedItems[0].name
      await sendBookingConfirmationSms(userData.phone, label, scheduled_at, otp)
    }

    return NextResponse.json({ booking_id: booking.id, final_amount: finalAmount })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}