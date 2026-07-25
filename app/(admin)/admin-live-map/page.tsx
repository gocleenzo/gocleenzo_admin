import WorkerLiveMap from './worker_live_map'

export const dynamic = 'force-dynamic'

export default function AdminLiveMapPage() {
  return (
    <div className="h-[calc(100vh-3.5rem)] md:h-screen">
      <WorkerLiveMap />
    </div>
  )
}