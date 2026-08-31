import BookingsDashboard from '../admin-bookings/bookings_dashboard'

// New page — same table/filters/actions as admin-bookings, scoped to
// bookings whose SCHEDULED date falls in the current calendar month.
export default function AdminBookingsMonthlyPage() {
  return <BookingsDashboard scope="month" />
}