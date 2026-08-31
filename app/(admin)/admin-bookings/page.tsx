import BookingsDashboard from '../admin-bookings/bookings_dashboard'

// All-time bookings — unchanged route (/admin-bookings) so any existing
// bookmarks/links keep working. No date filter applied to the fetch,
// same as the original single-page behavior. bookings_dashboard.tsx
// lives IN this same admin-bookings folder (not at the (admin) root
// like overview_dashboard.tsx) because it imports ./assign_map and
// ./recurring_package_badge as relative siblings — moving it up a
// level would have broken those imports.
export default function AdminBookingsPage() {
  return <BookingsDashboard scope="all" />
}