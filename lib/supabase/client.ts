import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        autoRefreshToken: false,   // ← stops the refresh token error
        persistSession: false,     // ← don't try to persist what doesn't exist
        detectSessionInUrl: false, // ← don't look for session in URL
      },
    }
  )
}