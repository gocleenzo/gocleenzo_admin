import OverviewDashboard from '../overview_dashboard'

// New page — same layout/cards as admin-overview, scoped to the current
// calendar month (bookings/revenue only; Today/Active orders/Location on
// stay live regardless of range, see overview_dashboard.tsx).
export default function AdminOverviewMonthlyPage() {
  return <OverviewDashboard range="month" />
}