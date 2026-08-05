'use client';

// ── Service Zones admin page ────────────────────────────────────────────
// Draw polygons to define exactly which buildings/streets are
// serviceable — replaces pincode-based `service_areas` matching.
// Anything NOT inside a drawn, active polygon is automatically treated
// as not-serviceable by the customer app.
//
// NOTE ON DRAWING: Google removed the Drawing Library's DrawingManager
// from the Maps JavaScript API entirely as of v3.65 (it's not just
// deprecated — the class no longer exists, and using it throws at
// runtime: "The DrawingManager functionality in the Maps JavaScript API
// is no longer available"). Google's endorsed replacement is a separate
// library called Terra Draw, but it's a different architecture
// (GeoJSON-based, adapter pattern) — not a drop-in swap. Since we only
// need simple click-to-place-a-vertex polygon drawing, it's simpler and
// has one fewer dependency to hand-roll that ourselves with plain map
// click listeners rather than pull in Terra Draw for this one use case.

import { useCallback, useEffect, useRef, useState } from 'react';
import { GoogleMap, Marker, Polygon, useJsApiLoader } from '@react-google-maps/api';
import { createClient } from '@/lib/supabase/client';
import { GOOGLE_MAPS_LOADER_OPTIONS } from '@/lib/googleMapsLoader';

type LatLngPoint = { lat: number; lng: number };

type ServiceZone = {
  id: string;
  name: string;
  polygon: LatLngPoint[];
  is_active: boolean;
  is_exclusion: boolean;
  created_at: string;
};

const MAP_CONTAINER_STYLE = { width: '100%', height: '100%' };

// Mumbai default center — adjust if your service area is elsewhere.
const DEFAULT_CENTER = { lat: 19.076, lng: 72.8777 };
const DEFAULT_ZOOM = 12;

const ACTIVE_ZONE_COLOR = '#0891B2';   // matches admin-areas' cyan-600
const INACTIVE_ZONE_COLOR = '#94A3B8'; // slate-400
const DRAFT_ZONE_COLOR = '#059669';    // emerald-600
const EXCLUSION_ZONE_COLOR = '#DC2626'; // red-600 — always red, regardless of active state

export default function AdminServiceZones() {
  const supabase = createClient();

  // No 'libraries: drawing' needed anymore — we don't use DrawingManager.
  // Uses the shared loader config (same id/options as every other admin
  // page) — required by @react-google-maps/api's singleton loader, see
  // lib/googleMapsLoader.ts.
  const { isLoaded } = useJsApiLoader(GOOGLE_MAPS_LOADER_OPTIONS);

  const [zones, setZones] = useState<ServiceZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ── Custom drawing state ──────────────────────────────────────────
  // isDrawing = actively placing points by clicking the map.
  // draftPoints = vertices placed so far (shown live as a polygon
  // preview). Once the admin clicks "Finish shape" with 3+ points, the
  // name form appears and isDrawing turns off (but draftPoints is kept
  // so the shape stays visible while naming/saving it).
  const [isDrawing, setIsDrawing] = useState(false);
  const [draftPoints, setDraftPoints] = useState<LatLngPoint[]>([]);
  const [draftName, setDraftName] = useState('');
  const [draftIsExclusion, setDraftIsExclusion] = useState(false);

  const mapRef = useRef<google.maps.Map | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase
        .from('service_zones')
        .select('id, name, polygon, is_active, is_exclusion, created_at')
        .order('created_at', { ascending: false });
      if (error) {
        setErr(error.message);
        return;
      }
      setZones((data ?? []) as ServiceZone[]);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not load service zones');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCount = zones.filter((z) => z.is_active).length;
  const hasDraft = draftPoints.length > 0;

  // ── Drawing controls ────────────────────────────────────────────
  function startDrawing() {
    setDraftPoints([]);
    setDraftName('');
    setIsDrawing(true);
  }

  const handleMapClick = useCallback(
    (e: google.maps.MapMouseEvent) => {
      if (!isDrawing || !e.latLng) return;
      setDraftPoints((prev) => [
        ...prev,
        { lat: e.latLng!.lat(), lng: e.latLng!.lng() },
      ]);
    },
    [isDrawing]
  );

  function undoLastPoint() {
    setDraftPoints((prev) => prev.slice(0, -1));
  }

  function finishShape() {
    if (draftPoints.length < 3) {
      setErr('Place at least 3 points before finishing the shape.');
      return;
    }
    setIsDrawing(false);
  }

  function cancelDrawing() {
    setIsDrawing(false);
    setDraftPoints([]);
    setDraftName('');
    setDraftIsExclusion(false);
  }

  // ── Save the draft as a new zone ────────────────────────────────────
  async function handleSaveDraft() {
    if (draftPoints.length < 3) {
      setErr('Draw a polygon with at least 3 points first.');
      return;
    }
    if (!draftName.trim()) {
      setErr('Give this zone a name before saving.');
      return;
    }
    setSaving(true);
    setErr(null);
    const { data, error } = await supabase
      .from('service_zones')
      .insert({ name: draftName.trim(), polygon: draftPoints, is_active: true, is_exclusion: draftIsExclusion })
      .select('*')
      .single();
    setSaving(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setZones((prev) => [data as ServiceZone, ...prev]);
    setDraftPoints([]);
    setDraftName('');
    setDraftIsExclusion(false);
  }

  async function toggleZone(zone: ServiceZone) {
    setZones((prev) =>
      prev.map((z) => (z.id === zone.id ? { ...z, is_active: !z.is_active } : z))
    );
    const { error } = await supabase
      .from('service_zones')
      .update({ is_active: !zone.is_active })
      .eq('id', zone.id);
    if (error) {
      setZones((prev) =>
        prev.map((z) => (z.id === zone.id ? { ...z, is_active: zone.is_active } : z))
      );
      setErr(error.message);
    }
  }

  async function deleteZone(zone: ServiceZone) {
    if (
      !window.confirm(
        `Delete "${zone.name}"? Customers inside this zone will no longer be able to book. This cannot be undone.`
      )
    )
      return;
    setZones((prev) => prev.filter((z) => z.id !== zone.id));
    const { error } = await supabase.from('service_zones').delete().eq('id', zone.id);
    if (error) {
      setErr(error.message);
      await load();
    }
  }

  return (
    <div className="flex h-screen">
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <div className="w-[360px] shrink-0 border-r border-slate-200 bg-white p-6 space-y-5 overflow-y-auto">
        <div>
          <h1 className="text-xl font-black text-slate-800">Service Zones</h1>
          <p className="text-sm text-slate-500 mt-1">
            Draw a polygon around each area you serve. A customer&apos;s address is
            matched by its exact point on the map — anything outside every active
            zone can still be saved, but can&apos;t complete a booking.
          </p>
        </div>

        {err && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-3">
            <p className="text-sm font-bold text-red-700">{err}</p>
          </div>
        )}

        {/* Active drawing controls */}
        {isDrawing && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
            <p className="text-xs font-black uppercase tracking-wide text-emerald-700">
              Drawing — {draftPoints.length} point{draftPoints.length === 1 ? '' : 's'} placed
            </p>
            <p className="text-[12px] text-emerald-700">
              Click on the map to place each corner of the shape. Add at least 3
              points, then finish.
            </p>
            <div className="flex gap-2">
              <button
                onClick={undoLastPoint}
                disabled={draftPoints.length === 0}
                className="px-3 py-2 rounded-xl border border-emerald-300 text-xs font-bold text-emerald-700 hover:bg-white disabled:opacity-40"
              >
                Undo last point
              </button>
              <button
                onClick={finishShape}
                disabled={draftPoints.length < 3}
                className="flex-1 px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-40"
              >
                Finish shape
              </button>
              <button
                onClick={cancelDrawing}
                className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-white"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Naming form — shown once shape is finished, before saving */}
        {!isDrawing && hasDraft && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
            <p className="text-xs font-black uppercase tracking-wide text-emerald-700">
              New zone — {draftPoints.length} points
            </p>
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveDraft();
              }}
              placeholder="Zone name (e.g. Satsang CHSL area)"
              autoFocus
              className="w-full px-3 py-2 rounded-xl border border-emerald-200 text-sm font-semibold text-slate-700 outline-none focus:border-emerald-400 bg-white"
            />

            {/* Coverage vs Excluded — determines what this shape actually
                does. Coverage zones (the original system) are being phased
                out in favor of pincode-based worker assignment, but the
                option is kept for backward compatibility. Excluded zones
                are the new, purpose-built hard-block: any address inside
                one is refused at booking time, before any worker or
                pincode logic even runs — for precisely-drawn no-go areas
                like a specific chawl, where blocking an entire pincode
                would incorrectly also block legitimate nearby societies. */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDraftIsExclusion(false)}
                className="flex-1 px-3 py-2 rounded-xl text-xs font-bold border transition-all"
                style={{
                  background: !draftIsExclusion ? '#0891B2' : '#fff',
                  color: !draftIsExclusion ? '#fff' : '#64748b',
                  borderColor: !draftIsExclusion ? 'transparent' : '#E2E8F0',
                }}
              >
                Coverage area
              </button>
              <button
                type="button"
                onClick={() => setDraftIsExclusion(true)}
                className="flex-1 px-3 py-2 rounded-xl text-xs font-bold border transition-all"
                style={{
                  background: draftIsExclusion ? '#DC2626' : '#fff',
                  color: draftIsExclusion ? '#fff' : '#64748b',
                  borderColor: draftIsExclusion ? 'transparent' : '#E2E8F0',
                }}
              >
                🚫 Excluded area
              </button>
            </div>
            {draftIsExclusion && (
              <p className="text-[11px] text-red-600 font-medium">
                No one will ever be able to book any address inside this shape —
                this overrides worker/pincode assignment entirely.
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleSaveDraft}
                disabled={saving}
                className="flex-1 px-4 py-2 rounded-xl bg-cyan-600 text-white text-sm font-bold hover:bg-cyan-700 disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save Zone'}
              </button>
              <button
                onClick={cancelDrawing}
                disabled={saving}
                className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50"
              >
                Discard
              </button>
            </div>
          </div>
        )}

        {!isDrawing && !hasDraft && (
          <button
            onClick={startDrawing}
            disabled={!isLoaded}
            className="w-full px-4 py-2.5 rounded-xl bg-slate-800 text-white text-sm font-bold hover:bg-slate-900 disabled:opacity-40"
          >
            + Draw New Zone
          </button>
        )}

        {/* Zone list */}
        <div className="rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <p className="text-xs font-black uppercase tracking-wide text-slate-400">
              Zones
            </p>
            <span className="text-[11px] font-bold text-cyan-700 bg-cyan-50 px-2.5 py-1 rounded-full">
              {activeCount} active
            </span>
          </div>

          {loading ? (
            <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
          ) : zones.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6 px-4">
              No zones drawn yet — everyone shows as serviceable until you add one.
            </p>
          ) : (
            <div className="p-2 space-y-2">
              {zones.map((zone) => (
                <div
                  key={zone.id}
                  className="px-3 py-2.5 rounded-xl border"
                  style={{
                    background: zone.is_active ? '#ECFEFF' : '#F8FAFC',
                    borderColor: zone.is_active ? '#A5F3FC' : '#E2E8F0',
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="text-sm font-black truncate"
                        style={{ color: zone.is_active ? '#0E7490' : '#94A3B8' }}
                      >
                        {zone.name}
                      </span>
                      {zone.is_exclusion && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 shrink-0">
                          🚫 Excluded
                        </span>
                      )}
                    </div>
                    <span
                      className="text-[10px] font-black px-2 py-0.5 rounded-full shrink-0 ml-2"
                      style={{
                        background: zone.is_active ? '#DCFCE7' : '#F1F5F9',
                        color: zone.is_active ? '#15803D' : '#94A3B8',
                      }}
                    >
                      {zone.is_active ? 'Live' : 'Disabled'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">
                      {zone.polygon.length} points
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleZone(zone)}
                        className="relative w-11 h-6 rounded-full transition-colors"
                        style={{ background: zone.is_active ? '#0891B2' : '#CBD5E1' }}
                      >
                        <span
                          className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
                          style={{ left: zone.is_active ? '22px' : '2px' }}
                        />
                      </button>
                      <button
                        onClick={() => deleteZone(zone)}
                        className="text-slate-400 hover:text-red-600 text-sm px-1"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Map ─────────────────────────────────────────────────── */}
      <div className="flex-1 relative">
        {isDrawing && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-full bg-slate-900 text-white text-xs font-bold shadow-lg">
            Click the map to place points
          </div>
        )}
        {!isLoaded ? (
          <div className="w-full h-full flex items-center justify-center bg-slate-50">
            <p className="text-sm text-slate-400">Loading map…</p>
          </div>
        ) : (
          <GoogleMap
            mapContainerStyle={MAP_CONTAINER_STYLE}
            center={DEFAULT_CENTER}
            zoom={DEFAULT_ZOOM}
            onLoad={(m) => {
              mapRef.current = m;
            }}
            onClick={handleMapClick}
            options={{
              streetViewControl: false,
              mapTypeControl: false,
              fullscreenControl: false,
              draggableCursor: isDrawing ? 'crosshair' : undefined,
            }}
          >
            {/* Live preview of the shape currently being drawn/named */}
            {draftPoints.length >= 2 && (
              <Polygon
                path={draftPoints}
                options={{
                  fillColor: DRAFT_ZONE_COLOR,
                  fillOpacity: 0.25,
                  strokeColor: DRAFT_ZONE_COLOR,
                  strokeWeight: 2,
                  clickable: false,
                }}
              />
            )}

            {/* Individual vertex markers — every clicked point gets a
                visible numbered dot, so it's clear exactly where each
                corner landed (not just the connecting lines between
                them). The first point is shown in a different color so
                it's obvious which one starts the shape. */}
            {draftPoints.map((point, i) => (
              <Marker
                key={`draft-point-${i}`}
                position={point}
                label={{
                  text: String(i + 1),
                  color: '#FFFFFF',
                  fontSize: '11px',
                  fontWeight: '700',
                }}
                icon={{
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 10,
                  fillColor: i === 0 ? '#0891B2' : DRAFT_ZONE_COLOR,
                  fillOpacity: 1,
                  strokeColor: '#FFFFFF',
                  strokeWeight: 2,
                }}
                zIndex={1000}
              />
            ))}

            {/* Existing saved zones, rendered read-only */}
            {zones.map((zone) => (
              <Polygon
                key={zone.id}
                path={zone.polygon}
                options={{
                  fillColor: zone.is_exclusion
                    ? EXCLUSION_ZONE_COLOR
                    : zone.is_active ? ACTIVE_ZONE_COLOR : INACTIVE_ZONE_COLOR,
                  fillOpacity: zone.is_exclusion ? 0.2 : 0.15,
                  strokeColor: zone.is_exclusion
                    ? EXCLUSION_ZONE_COLOR
                    : zone.is_active ? ACTIVE_ZONE_COLOR : INACTIVE_ZONE_COLOR,
                  strokeWeight: 2,
                  clickable: false,
                }}
              />
            ))}
          </GoogleMap>
        )}
      </div>
    </div>
  );
}