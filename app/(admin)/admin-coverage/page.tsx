import CoverageMap from './coverage_map'

export const dynamic = 'force-dynamic'

export default function AdminCoveragePage() {
  return (
    <div className="h-[calc(100vh-3.5rem)] md:h-screen">
      <CoverageMap />
    </div>
  )
}