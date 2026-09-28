import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSession } from './lib/adminAuth'

const PUBLIC_PATHS = ['/login', '/api/admin-auth/login', '/api/admin-auth/logout']
const PUBLIC_API_PREFIXES = [
  '/api/payments/', '/api/notifications/dispatch', '/api/sos', '/api/workers/live',
]

// Every route an assistant is allowed to reach. Add here (and in
// admin_layout.tsx's ASSISTANT_NAV) if they're ever given another page.
const ASSISTANT_ALLOWED_PATHS = ['/assistant-dashboard', '/admin-workers']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next()
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next()

  const isAdminArea = pathname.startsWith('/admin-') || pathname === '/'
  if (!isAdminArea) return NextResponse.next()

  const token = req.cookies.get('admin_session')?.value
  const session = token ? await verifyAdminSession(token) : null

  if (!session) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  if (session.role === 'assistant' && !ASSISTANT_ALLOWED_PATHS.includes(pathname)) {
    return NextResponse.redirect(new URL('/assistant-dashboard', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}