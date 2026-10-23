// /api/staff/areas — owner only.
//   GET  → every area name (from Service Areas) + which assistant has which
//   POST { admin_user_id, areas: string[] } → replaces that assistant's areas
import { NextRequest, NextResponse } from 'next/server'
import { staffSession } from '@/lib/staffScope'
import { createServiceClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

async function owner(req: NextRequest) {
  const s = await staffSession(req)
  return s && s.role === 'owner' ? s : null
}

export async function GET(req: NextRequest) {
  if (!(await owner(req))) return NextResponse.json({ error: 'Only the owner can manage areas' }, { status: 403 })
  const db = createServiceClient()
  const [{ data: list, error: e1 }, { data: links, error: e2 }] = await Promise.all([
    db.rpc('staff_area_list'),
    db.from('assistant_areas').select('admin_user_id, area_name'),
  ])
  if (e1 || e2) {
    const msg = (e1 ?? e2)!.message
    return NextResponse.json({
      error: /assistant_areas|staff_area_list/.test(msg) ? 'Run assistant_areas.sql in Supabase first.' : msg,
    }, { status: 500 })
  }
  const byAssistant: Record<string, string[]> = {}
  ;(links ?? []).forEach((r: any) => { (byAssistant[r.admin_user_id] ??= []).push(r.area_name) })
  return NextResponse.json({ areas: list ?? [], assigned: byAssistant })
}

export async function POST(req: NextRequest) {
  if (!(await owner(req))) return NextResponse.json({ error: 'Only the owner can manage areas' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const id = String(body?.admin_user_id ?? '')
  const areas: string[] = Array.isArray(body?.areas)
    ? Array.from(new Set(body.areas.map((a: any) => String(a ?? '').trim()).filter(Boolean))) as string[]
    : []
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Assistant not found' }, { status: 400 })

  const db = createServiceClient()
  const { data: who } = await db.from('admin_users').select('id, role').eq('id', id).maybeSingle()
  if (!who || who.role !== 'assistant') return NextResponse.json({ error: 'Assistant not found' }, { status: 404 })

  const { error: delErr } = await db.from('assistant_areas').delete().eq('admin_user_id', id)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
  if (areas.length > 0) {
    const { error } = await db.from('assistant_areas')
      .insert(areas.map(a => ({ admin_user_id: id, area_name: a })))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true, areas })
}