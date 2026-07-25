'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// ── shared styles ──────────────────────────────────────────────
export const BG = 'linear-gradient(160deg, #E0F9FF 0%, #BAF3FB 40%, #7DD8F0 100%)'

export const CARD_STYLE = {
  background:   '#ffffff',
  borderRadius: '32px',
  boxShadow:    '0 32px 80px rgba(6,182,212,0.18), 0 8px 24px rgba(0,0,0,0.08)',
}

// ── reusable phone input ────────────────────────────────────────
export function PhoneInput({
  value, onChange
}: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl px-4 py-3.5 transition-all"
      style={{ border: '2px solid #A5F3FC', background: '#F0FDFF' }}>
      <span className="text-xl flex-shrink-0">🇮🇳</span>
      <span className="text-cyan-700 font-bold text-sm flex-shrink-0">+91</span>
      <div className="w-px h-5 bg-cyan-200 mx-1 flex-shrink-0" />
      <input
        type="tel"
        placeholder="98765 43210"
        value={value}
        onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 10))}
        className="flex-1 bg-transparent outline-none text-gray-900 font-bold
          text-base placeholder-cyan-300"
      />
      {value.length === 10 && (
        <span className="text-cyan-500 text-sm flex-shrink-0">✓</span>
      )}
    </div>
  )
}

// ── OTP boxes ──────────────────────────────────────────────────
export function OtpInput({
  value, onChange
}: { value: string[]; onChange: (v: string[]) => void }) {
  function handleChange(val: string, idx: number) {
    if (!/^\d*$/.test(val)) return
    const next = [...value]
    next[idx] = val.slice(-1)
    onChange(next)
    if (val && idx < 5) {
      document.getElementById(`otp-box-${idx + 1}`)?.focus()
    }
  }
  function handleKey(e: React.KeyboardEvent, idx: number) {
    if (e.key === 'Backspace' && !value[idx] && idx > 0) {
      document.getElementById(`otp-box-${idx - 1}`)?.focus()
    }
  }
  return (
    <div className="flex gap-2.5 justify-center">
      {value.map((d, i) => (
        <input
          key={i}
          id={`otp-box-${i}`}
          type="text"
          inputMode="numeric"
          value={d}
          maxLength={1}
          onChange={e => handleChange(e.target.value, i)}
          onKeyDown={e => handleKey(e, i)}
          className="w-11 h-14 text-center text-xl font-black rounded-2xl outline-none
            transition-all"
          style={{
            border:     d ? '2px solid #06B6D4' : '2px solid #A5F3FC',
            background: d ? '#ECFEFF' : '#F0FDFF',
            color:      '#0891B2',
            boxShadow:  d ? '0 4px 12px rgba(6,182,212,0.2)' : 'none',
          }}
        />
      ))}
    </div>
  )
}

// ── cyan button ────────────────────────────────────────────────
export function CyanButton({
  onClick, disabled, loading, children
}: {
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="w-full h-14 rounded-2xl text-white font-black text-base
        flex items-center justify-center gap-2.5 active:scale-95 transition-all
        disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        background: 'linear-gradient(135deg, #06B6D4 0%, #0891B2 100%)',
        boxShadow:  disabled ? 'none' : '0 8px 24px rgba(6,182,212,0.45)',
      }}>
      {loading ? (
        <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10"
            stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : children}
    </button>
  )
}

// ── outline button ─────────────────────────────────────────────
export function OutlineButton({
  onClick, children
}: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-full h-14 rounded-2xl font-black text-base flex items-center
        justify-center gap-2.5 active:scale-95 transition-all border-2"
      style={{ borderColor: '#06B6D4', color: '#0891B2', background: 'transparent' }}>
      {children}
    </button>
  )
}

// ── error box ──────────────────────────────────────────────────
export function ErrorBox({ msg }: { msg: string }) {
  if (!msg) return null
  return (
    <div className="flex items-center gap-2 px-4 py-3 rounded-2xl"
      style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
      <span className="text-base">⚠️</span>
      <p className="text-red-600 text-xs font-semibold">{msg}</p>
    </div>
  )
}

// ── back button ────────────────────────────────────────────────
export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-9 h-9 rounded-xl flex items-center justify-center mb-5
        active:scale-90 transition-transform"
      style={{ background: '#E0F9FF' }}>
      <svg className="w-4 h-4 text-cyan-700" fill="none" viewBox="0 0 24 24"
        stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  )
}

// ── card header band ───────────────────────────────────────────
export function CardHeader({
  emoji, title, subtitle
}: { emoji: string; title: string; subtitle: string }) {
  return (
    <div className="px-6 pt-6 pb-5 rounded-t-[32px]"
      style={{ background: 'linear-gradient(135deg,#ECFEFF,#CFFAFE)' }}>
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center
          text-2xl shadow-md" style={{ background: 'rgba(6,182,212,0.15)' }}>
          {emoji}
        </div>
        <div>
          <h2 className="text-xl font-black text-gray-900">{title}</h2>
          <p className="text-cyan-700 text-xs mt-0.5">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}

// ── shared hook: send + verify OTP ────────────────────────────
export function useOtpFlow() {
  const supabase = createClient()
  const [phone,   setPhone]   = useState('')
  const [otp,     setOtp]     = useState(['','','','','',''])
  const [step,    setStep]    = useState<'phone'|'otp'>('phone')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  async function sendOtp(phoneNum = phone) {
    if (phoneNum.length < 10) { setError('Enter a valid 10-digit number'); return null }
    setError('')
    setLoading(true)
    const res = await fetch('/api/otp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phoneNum }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error || 'Failed to send OTP'); return null }
    setStep('otp')
    return phoneNum
  }

  async function verifyOtp(phoneNum = phone) {
  const code = otp.join('')

  if (code.length < 6) {
    setError('Enter the 6-digit OTP')
    return null
  }

  setError('')
  setLoading(true)

  const res = await fetch('/api/otp/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: phoneNum,
      otp: code,
    }),
  })

  const data = await res.json()
  setLoading(false)

  if (!res.ok) {
    setError(data.error || 'Invalid OTP')
    return null
  }

  // ✅ IMPORTANT: Create Supabase session on the client
  if (data.access_token && data.refresh_token) {
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    })

    if (sessionError) {
      console.error('Session creation failed:', sessionError)
      setError('Login succeeded but session creation failed')
      return null
    }
  }

  return data.user
}

  return {    
    phone, setPhone, otp, setOtp, step, setStep,
    loading, error, setError, sendOtp, verifyOtp,
    supabase,
  }
}