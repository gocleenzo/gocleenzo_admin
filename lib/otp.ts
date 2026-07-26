// lib/otp.ts
// OTP generation for booking confirmation (NOT for auth — auth uses Supabase phone OTP)

// ─── Generate OTP (for booking verification) ─────────────────────────────────
export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// ─── Send booking confirmation SMS ────────────────────────────────────────────
// PLACEHOLDER: no SMS provider is currently configured for this project
// (MSG91 was removed; Supabase Phone Auth only handles login OTP, not
// arbitrary outbound messages). This logs instead of sending so booking
// creation doesn't fail, but customers will NOT actually receive an SMS
// until a real provider (e.g. Twilio, MSG91) is wired in here.
//
// To enable real sending later: add the provider's API call below, guarded
// by its own env vars (e.g. TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN), and
// keep the try/catch so a failed SMS never blocks booking creation.
export async function sendBookingConfirmationSms(
  phone: string,
  serviceLabel: string,
  scheduledAt: string,
  otp: string
): Promise<boolean> {
  try {
    console.log(
      `[sendBookingConfirmationSms] STUB — no SMS provider configured. ` +
      `Would send to ${phone}: "${serviceLabel} booked for ${scheduledAt}. Your OTP: ${otp}"`
    )
    // No-op: return true so callers don't treat this as a failure while
    // it's still a placeholder.
    return true
  } catch (err) {
    console.error('sendBookingConfirmationSms error:', err)
    return false
  }
}