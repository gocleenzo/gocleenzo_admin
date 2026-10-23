// app/(admin)/_lib/fetch_all.ts
// ─────────────────────────────────────────────────────────────────────
// Supabase gives back at most 1,000 rows per request. Once a table has
// more (customers, bookings, addresses …) the rest are silently left
// out, so counts get stuck at 1,000.
//
// fetchAllRows() asks again, 1,000 at a time, until everything is in.
// Pass a function that BUILDS the query (it must have an .order()), e.g.
//
//   const { data, error } = await fetchAllRows(() =>
//     supabase.from('users').select('id,full_name').order('created_at').order('id'))
// ─────────────────────────────────────────────────────────────────────
const PAGE = 1000

export async function fetchAllRows<T = any>(
  build: () => any,
  maxRows = 200000,
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  const all: T[] = []
  for (let from = 0; from < maxRows; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) return { data: all.length ? all : null, error }
    const rows = (data ?? []) as T[]
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return { data: all, error: null }
}