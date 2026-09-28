import { SignJWT, jwtVerify } from 'jose'

export type AdminSession = {
  id: string
  email: string
  role: 'owner' | 'assistant'
  full_name: string | null
}

const SECRET = new TextEncoder().encode(process.env.ADMIN_JWT_SECRET!)

export async function signAdminSession(payload: AdminSession): Promise<string> {
  return await new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(SECRET)
}

export async function verifyAdminSession(token: string): Promise<AdminSession | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    return payload as unknown as AdminSession
  } catch {
    return null
  }
}