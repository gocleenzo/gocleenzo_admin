import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { verifyAdminSession } from '@/lib/adminAuth'

// app/api/settings/festivals/route.ts
// 🪔 Festival themes: the customer app changes its look by itself on the
// dates set here. Everyone on the admin team can VIEW; only the owner
// can CHANGE, upload pictures or send a test push.
//
// GET                         → { role, themes, services }
// POST (JSON)  { action: 'save_theme' | 'delete_theme' | 'save_banner'
//                        | 'delete_banner' | 'test_push', ... }
// POST (form)  file=<picture or Lottie .json>  → { url }

export const dynamic = 'force-dynamic'

const BUCKET = 'festive'
const MAX_BYTES = 4 * 1024 * 1024
const PACKS = ['none', 'diwali']
const COLOR_KEYS = ['main', 'header', 'accent', 'bg', 'card', 'text'] as const
const EFFECT_KEYS = ['falling', 'lights', 'fireworks', 'shimmer'] as const
const URL_FIELDS = ['header_image_url', 'splash_image_url', 'particle_image_url', 'lottie_header_url', 'lottie_celebrate_url'] as const
const TEXT_FIELDS: Record<string, number> = {
  greeting: 60, subline: 90, splash_text: 60, confirm_text: 120, featured_title: 40, push_title: 60, push_body: 200,
}
const ALLOWED_TYPES: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'application/json': 'json',
}

async function session(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  return token ? await verifyAdminSession(token) : null
}

const isHex = (v: any) => typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v)
const isDate = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const isUuid = (v: any) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)
const cleanUrl = (v: any) => {
  const s = String(v ?? '').trim()
  return s === '' ? null : /^https:\/\/\S+$/.test(s) && s.length < 600 ? s : undefined
}
const cleanText = (v: any, max: number) => {
  const s = String(v ?? '').trim()
  return s === '' ? null : s.slice(0, max)
}
const digits10 = (v: any) => String(v ?? '').replace(/\D/g, '').slice(-10)

export async function GET(req: NextRequest) {
  const s = await session(req)
  if (!s) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  const sb = createServiceClient()

  const [themes, banners, services] = await Promise.all([
    sb.from('festival_themes').select('*').order('start_date', { ascending: false, nullsFirst: false }),
    sb.from('festival_banners').select('*').order('sort_order', { ascending: true }),
    sb.from('services').select('id, name').order('name'),
  ])
  if (themes.error) return NextResponse.json({ error: themes.error.message }, { status: 500 })

  const byTheme: Record<string, any[]> = {}
  for (const b of banners.data ?? []) (byTheme[b.theme_id] ??= []).push(b)

  return NextResponse.json({
    role: s.role,
    themes: (themes.data ?? []).map((t: any) => ({ ...t, banners: byTheme[t.id] ?? [] })),
    services: services.data ?? [],
  })
}

export async function POST(req: NextRequest) {
  const s = await session(req)
  if (!s) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  if (s.role !== 'owner') return NextResponse.json({ error: 'Only the owner can change festival themes' }, { status: 403 })
  const sb = createServiceClient()

  // ── Upload a picture or Lottie animation ─────────────────────────
  const ctype = req.headers.get('content-type') || ''
  if (ctype.startsWith('multipart/form-data')) {
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!file || typeof file === 'string') return NextResponse.json({ error: 'No file' }, { status: 400 })
    const f = file as File
    let type = f.type
    if (!type && f.name.toLowerCase().endsWith('.json')) type = 'application/json'
    const ext = ALLOWED_TYPES[type]
    if (!ext) return NextResponse.json({ error: 'Use a PNG, JPG, WEBP, GIF picture or a Lottie .json file' }, { status: 400 })
    if (f.size > MAX_BYTES) return NextResponse.json({ error: 'File is larger than 4 MB. Please use a smaller one.' }, { status: 400 })
    const bytes = new Uint8Array(await f.arrayBuffer())
    if (ext === 'json') {
      try { JSON.parse(new TextDecoder().decode(bytes)) } catch { return NextResponse.json({ error: 'That .json file is not a valid Lottie animation' }, { status: 400 }) }
    }
    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`
    const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: false, cacheControl: '31536000' })
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 })
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path)
    return NextResponse.json({ url: data.publicUrl })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body.action !== 'string') return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  // ── Create / update a festival ───────────────────────────────────
  if (body.action === 'save_theme') {
    const t = body.theme ?? {}
    const name = cleanText(t.name, 40)
    if (!name) return NextResponse.json({ error: 'Give the festival a name' }, { status: 400 })
    const start = t.start_date ? (isDate(t.start_date) ? t.start_date : undefined) : null
    const end = t.end_date ? (isDate(t.end_date) ? t.end_date : undefined) : null
    if (start === undefined || end === undefined) return NextResponse.json({ error: 'Dates are not valid' }, { status: 400 })
    if (start && end && end < start) return NextResponse.json({ error: 'End date is before the start date' }, { status: 400 })
    if (t.is_enabled && (!start || !end)) return NextResponse.json({ error: 'Set start and end dates before switching it on' }, { status: 400 })

    const colors: Record<string, string> = {}
    for (const k of COLOR_KEYS) {
      if (!isHex(t.colors?.[k])) return NextResponse.json({ error: `Colour "${k}" is not valid` }, { status: 400 })
      colors[k] = t.colors[k].toUpperCase()
    }
    const effects: Record<string, boolean> = {}
    for (const k of EFFECT_KEYS) effects[k] = t.effects?.[k] === true

    const row: Record<string, any> = {
      name, start_date: start, end_date: end,
      priority: Math.max(0, Math.min(100, Math.round(Number(t.priority) || 0))),
      is_enabled: t.is_enabled === true,
      pack: PACKS.includes(t.pack) ? t.pack : 'none',
      colors, effects,
      featured_service_ids: Array.isArray(t.featured_service_ids) ? t.featured_service_ids.filter(isUuid).slice(0, 12) : [],
      preview_phones: Array.isArray(t.preview_phones)
        ? Array.from(new Set(t.preview_phones.map(digits10).filter((p: string) => p.length === 10))).slice(0, 10)
        : [],
      push_enabled: t.push_enabled === true,
      updated_at: new Date().toISOString(),
    }
    for (const k of URL_FIELDS) {
      const u = cleanUrl(t[k])
      if (u === undefined) return NextResponse.json({ error: `${k.replace(/_/g, ' ')} must be an https link` }, { status: 400 })
      row[k] = u
    }
    for (const [k, max] of Object.entries(TEXT_FIELDS)) row[k] = cleanText(t[k], max)
    if (row.push_enabled && !row.push_body) return NextResponse.json({ error: 'Write the push message, or switch the push off' }, { status: 400 })

    let res
    if (t.id) {
      if (!isUuid(t.id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })
      // A changed start date means the day-1 push should go again
      const prev = await sb.from('festival_themes').select('start_date').eq('id', t.id).single()
      if (prev.data && prev.data.start_date !== start) row.push_sent_at = null
      res = await sb.from('festival_themes').update(row).eq('id', t.id).select('*').single()
    } else {
      res = await sb.from('festival_themes').insert(row).select('*').single()
    }
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 })
    return NextResponse.json({ ok: true, theme: res.data })
  }

  if (body.action === 'delete_theme') {
    if (!isUuid(body.id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })
    const { error } = await sb.from('festival_themes').delete().eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // ── Offer banners ────────────────────────────────────────────────
  if (body.action === 'save_banner') {
    const b = body.banner ?? {}
    if (!isUuid(b.theme_id)) return NextResponse.json({ error: 'Save the festival first' }, { status: 400 })
    const image = cleanUrl(b.image_url)
    if (!image) return NextResponse.json({ error: 'Upload a banner picture' }, { status: 400 })
    const row = {
      theme_id: b.theme_id,
      image_url: image,
      title: cleanText(b.title, 60),
      subtitle: cleanText(b.subtitle, 90),
      promo_code: cleanText(b.promo_code, 30)?.toUpperCase().replace(/\s+/g, '') ?? null,
      service_id: isUuid(b.service_id) ? b.service_id : null,
      sort_order: Math.max(0, Math.min(999, Math.round(Number(b.sort_order) || 0))),
      is_enabled: b.is_enabled !== false,
    }
    const res = b.id && isUuid(b.id)
      ? await sb.from('festival_banners').update(row).eq('id', b.id).select('*').single()
      : await sb.from('festival_banners').insert(row).select('*').single()
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 })
    return NextResponse.json({ ok: true, banner: res.data })
  }

  if (body.action === 'delete_banner') {
    if (!isUuid(body.id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })
    const { error } = await sb.from('festival_banners').delete().eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // ── Send the push greeting to one phone, to check it ─────────────
  if (body.action === 'test_push') {
    const phone = digits10(body.phone)
    if (phone.length !== 10) return NextResponse.json({ error: 'Enter a 10-digit phone number' }, { status: 400 })
    const title = cleanText(body.title, 60) || 'Cleenzo'
    const text = cleanText(body.body, 200)
    if (!text) return NextResponse.json({ error: 'Write the push message first' }, { status: 400 })
    const users = await sb.from('users').select('id, phone').like('phone', `%${phone}`).limit(3)
    if (users.error) return NextResponse.json({ error: users.error.message }, { status: 500 })
    if (!users.data?.length) return NextResponse.json({ error: 'No app user with that phone number' }, { status: 404 })
    const origin = req.nextUrl.origin
    let sent = 0
    for (const u of users.data) {
      const r = await fetch(`${origin}/api/notifications/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: u.id, title, body: text, data: { type: 'festival' } }),
      }).catch(() => null)
      if (r && r.ok) sent++
    }
    return NextResponse.json({ ok: sent > 0, sent })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}