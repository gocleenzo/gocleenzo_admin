// components/AssignedByTag.tsx
//
// Owner-only "assigned by" tag for bookings_dashboard.tsx.
// Drop this file in as components/AssignedByTag.tsx, then in
// bookings_dashboard.tsx:
//
//   import { useAssignedByMap, AssignedByTag } from '@/components/AssignedByTag'
//
//   // inside your dashboard component, alongside your other state:
//   const { assignedByMap, loadAssignedBy } = useAssignedByMap(supabase)
//
//   // after you've loaded/refreshed your bookings list, call:
//   loadAssignedBy(bookings.map(b => b.id))
//
//   // then in each booking card's JSX, next to the worker name:
//   <AssignedByTag isOwner={session.role === 'owner'} info={assignedByMap[b.id]} />

'use client'

import { useCallback, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

export type AssignedByInfo = {
  name: string
  action: 'assigned' | 'reassigned' | 'unassigned'
  at: string
}

export function useAssignedByMap(supabase: SupabaseClient) {
  const [assignedByMap, setAssignedByMap] = useState<Record<string, AssignedByInfo>>({})

  const loadAssignedBy = useCallback(async (bookingIds: string[]) => {
    if (!bookingIds || bookingIds.length === 0) {
      setAssignedByMap({})
      return
    }

    const { data, error } = await supabase
      .from('booking_assignment_log')
      .select('booking_id, action, performed_at, admin_users:performed_by(full_name, email)')
      .in('booking_id', bookingIds)
      .in('action', ['assigned', 'reassigned'])
      .order('performed_at', { ascending: false })

    if (error) {
      console.error('useAssignedByMap: failed to load booking_assignment_log', error)
      return
    }

    const map: Record<string, AssignedByInfo> = {}
    for (const row of (data ?? []) as any[]) {
      // Rows arrive newest-first, so the first row we see per booking_id
      // is that booking's most recent assign/reassign event.
      if (!map[row.booking_id]) {
        const admin = Array.isArray(row.admin_users) ? row.admin_users[0] : row.admin_users
        map[row.booking_id] = {
          name: admin?.full_name || admin?.email || 'Unknown',
          action: row.action,
          at: row.performed_at,
        }
      }
    }
    setAssignedByMap(map)
  }, [supabase])

  return { assignedByMap, loadAssignedBy }
}

export function AssignedByTag({
  isOwner,
  info,
}: {
  isOwner: boolean
  info?: AssignedByInfo
}) {
  if (!isOwner || !info) return null

  const label = info.action === 'reassigned' ? 'Reassigned' : 'Assigned'
  const when = new Date(info.at).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <span className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 whitespace-nowrap">
      {label} by {info.name} · {when}
    </span>
  )
}   