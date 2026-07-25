// app/api/admin/toggle-search-fee/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// IMPORTANT: this uses the SERVICE ROLE key, which bypasses RLS entirely.
// This file only ever runs on the server (Next.js route handler) — the
// service role key must NEVER be sent to the browser or prefixed with
// NEXT_PUBLIC_.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only env var, no NEXT_PUBLIC_ prefix
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// TODO: once real admin auth exists, verify the caller is an admin here
// before proceeding (e.g. check a session cookie / header against your
// admins table). Right now this route is reachable by anyone who can
// reach /admin-overview, matching the current (temporary) trust model.

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const enabled = Boolean(body?.enabled)

    const { data, error } = await supabaseAdmin
      .from('app_settings')
      .update({
        search_fee_enabled: enabled,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 'global')
      .select('platform_fee, search_fee, search_fee_enabled, updated_at')
      .maybeSingle()

    if (error) {
      console.error('[toggle-search-fee] update error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data) {
      console.error('[toggle-search-fee] no global row found to update')
      return NextResponse.json(
        { error: "No 'global' row found in app_settings" },
        { status: 404 }
      )
    }

    return NextResponse.json({ settings: data })
  } catch (err) {
    console.error('[toggle-search-fee] unexpected error:', err)
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 })
  }
}