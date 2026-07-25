// Shared shift/schedule logic for admin maps.
// Mirrors the worker admin page's isWithinShift().

type DaySchedule = {
  enabled: boolean
  start: string // "09:00"
  end: string   // "17:00"
  breaks?: { from: string; to: string }[]
}
export type WeekSchedule = Record<string, DaySchedule>

function timeToMins(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/**
 * Is the worker within their scheduled shift right now (India time),
 * and not on a break? No schedule = treated as always in-shift.
 */
export function isWithinShift(schedule: WeekSchedule | null | undefined): boolean {
  if (!schedule) return true
  // current time in Asia/Kolkata
  const now = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
  )
  const dayName = [
    'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
  ][now.getDay()]
  const day = schedule[dayName]
  if (!day || !day.enabled) return false
  const nowMins = now.getHours() * 60 + now.getMinutes()
  if (nowMins < timeToMins(day.start) || nowMins >= timeToMins(day.end)) return false
  for (const b of day.breaks ?? []) {
    if (nowMins >= timeToMins(b.from) && nowMins < timeToMins(b.to)) return false
  }
  return true
}