import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Cleenzo Admin',
  description: 'Cleenzo Admin Suite',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}