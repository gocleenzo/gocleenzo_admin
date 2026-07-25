import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Booking } from '@/types'

export function useRealtimeBookings(workerId: string) {
  const [pendingJobs, setPendingJobs] = useState<Booking[]>([])
  const supabase = createClient()

  useEffect(() => {
    // Load initial pending jobs
    supabase
      .from('bookings')
      .select('*, services(*), addresses(*), users!customer_id(*)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setPendingJobs(data as Booking[])
      })

    // Subscribe to changes
    const channel = supabase
      .channel('pending-bookings')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            // New booking — add to list if pending
            if (payload.new.status === 'pending') {
              setPendingJobs(prev => [payload.new as Booking, ...prev])
            }
          }
          if (payload.eventType === 'UPDATE') {
            // If a job was accepted by someone else — remove it
            if (payload.new.status !== 'pending') {
              setPendingJobs(prev =>
                prev.filter(j => j.id !== payload.new.id)
              )
            }
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [workerId])

  return pendingJobs
}