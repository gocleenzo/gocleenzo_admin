// lib/otp.ts
// OTP generation for booking confirmation (NOT for auth — auth uses Supabase phone OTP)

// ─── Generate OTP (for booking verification) ─────────────────────────────────
export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}
