import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const response = NextResponse.next()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return request.cookies.get(name)?.value },
        set(name: string, value: string, options: any) {
          response.cookies.set({ name, value, ...options })
        },
        remove(name: string, options: any) {
          response.cookies.set({ name, value: '', ...options })
        },
      },
    }
  )

  // Only refresh the session cookie — no redirects here.
  // Auth protection is handled by each layout using localStorage.
  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: [
    '/services/:path*',
    '/bookings/:path*',
    '/account/:path*',
    '/book/:path*',
    '/worker/:path*',
    '/admin-overview/:path*',
    '/admin-bookings/:path*',
    '/admin-workers/:path*',
    '/admin-reports/:path*',
    '/admin-promos/:path*',
    '/admin-complaints/:path*',
  ],
}