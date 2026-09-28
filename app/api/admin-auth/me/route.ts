// app/api/admin-auth/me/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/adminAuth'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  const session = token ? await verifyAdminSession(token) : null
  if (!session) return NextResponse.json({ session: null }, { status: 401 })
  return NextResponse.json({ session })
}