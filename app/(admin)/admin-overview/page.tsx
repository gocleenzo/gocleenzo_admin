import OverviewDashboard from '../overview_dashboard'

// All-time dashboard — unchanged route (/admin-overview) so any existing
// bookmarks/links keep working. Content is now the shared component,
// scoped to 'all' (no date filter, same as the original behavior).
export default function AdminOverviewPage() {
  return <OverviewDashboard range="all" />
}