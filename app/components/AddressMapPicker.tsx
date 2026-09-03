'use client'
import { useState, useRef, useCallback } from 'react'
import { GoogleMap, Marker, useJsApiLoader, Autocomplete } from '@react-google-maps/api'
import { GOOGLE_MAPS_LOADER_OPTIONS } from '@/lib/googleMapsLoader'

// ═══════════════════════════════════════════════════════════════
// AddressMapPicker — search an address (Google Places Autocomplete),
// map jumps there and drops a pin, admin can drag the pin to fine-
// tune the exact spot. Mirrors the customer app's own location
// search + picker flow (location_search_screen.dart +
// location_picker_screen.dart), just as a single combined widget
// suited to sitting inside an admin modal instead of two separate
// full screens.
//
// Reports back BOTH the structured address pieces (so the existing
// flat_no / building / area / city / pincode / full_address fields
// in the surrounding form still populate) AND the raw lat/lng, which
// the surrounding form is responsible for sending to the backend —
// this component itself does not touch the database.
// ═══════════════════════════════════════════════════════════════

export type PickedAddress = {
  lat: number
  lng: number
  fullAddress: string
  area: string
  city: string
  pincode: string
}

const MUMBAI_CENTER = { lat: 19.076, lng: 72.8777 }

function extractAddressParts(place: google.maps.places.PlaceResult): {
  area: string; city: string; pincode: string
} {
  const comps = place.address_components ?? []
  const get = (type: string) =>
    comps.find(c => c.types.includes(type))?.long_name ?? ''

  const area =
    get('sublocality_level_1') ||
    get('sublocality') ||
    get('neighborhood') ||
    get('locality') ||
    ''
  const city = get('locality') || get('administrative_area_level_2') || ''
  const pincode = get('postal_code')

  return { area, city, pincode }
}

export default function AddressMapPicker({
  onPick,
  initialLat,
  initialLng,
  heightClass = 'h-64',
}: {
  onPick: (picked: PickedAddress) => void
  initialLat?: number | null
  initialLng?: number | null
  heightClass?: string
}) {
  const { isLoaded } = useJsApiLoader(GOOGLE_MAPS_LOADER_OPTIONS)

  const [marker, setMarker] = useState<{ lat: number; lng: number } | null>(
    initialLat != null && initialLng != null ? { lat: initialLat, lng: initialLng } : null
  )
  const [searchText, setSearchText] = useState('')
  const [resolving, setResolving] = useState(false)

  const mapRef = useRef<google.maps.Map | null>(null)
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null)
  const geocoderRef = useRef<google.maps.Geocoder | null>(null)

  const reverseGeocodeAndReport = useCallback((lat: number, lng: number) => {
    if (!geocoderRef.current) geocoderRef.current = new google.maps.Geocoder()
    setResolving(true)
    geocoderRef.current.geocode({ location: { lat, lng } }, (results, status) => {
      setResolving(false)
      if (status === 'OK' && results && results[0]) {
        const place = results[0]
        const { area, city, pincode } = extractAddressParts(place as any)
        onPick({
          lat, lng,
          fullAddress: place.formatted_address ?? '',
          area, city, pincode,
        })
      } else {
        // Pin placed but reverse-geocoding failed — still report the
        // coordinates so the admin isn't blocked; address text fields
        // stay whatever was typed manually.
        onPick({ lat, lng, fullAddress: '', area: '', city: '', pincode: '' })
      }
    })
  }, [onPick])

  function handlePlaceChanged() {
    const place = autocompleteRef.current?.getPlace()
    if (!place || !place.geometry?.location) return
    const lat = place.geometry.location.lat()
    const lng = place.geometry.location.lng()
    const { area, city, pincode } = extractAddressParts(place)
    setMarker({ lat, lng })
    mapRef.current?.panTo({ lat, lng })
    mapRef.current?.setZoom(17)
    onPick({
      lat, lng,
      fullAddress: place.formatted_address ?? place.name ?? '',
      area, city, pincode,
    })
  }

  function handleMarkerDragEnd(e: google.maps.MapMouseEvent) {
    const lat = e.latLng?.lat()
    const lng = e.latLng?.lng()
    if (lat == null || lng == null) return
    setMarker({ lat, lng })
    reverseGeocodeAndReport(lat, lng)
  }

  function handleMapClick(e: google.maps.MapMouseEvent) {
    const lat = e.latLng?.lat()
    const lng = e.latLng?.lng()
    if (lat == null || lng == null) return
    setMarker({ lat, lng })
    reverseGeocodeAndReport(lat, lng)
  }

  if (!isLoaded) {
    return (
      <div className={`${heightClass} rounded-xl bg-slate-100 flex items-center justify-center`}>
        <p className="text-xs text-slate-400">Loading map…</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Autocomplete
        onLoad={(ac) => { autocompleteRef.current = ac }}
        onPlaceChanged={handlePlaceChanged}
        options={{ componentRestrictions: { country: 'in' } }}
      >
        <input
          type="text"
          placeholder="🔍 Search for the address…"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-slate-50 border border-slate-200 focus:border-cyan-400"
        />
      </Autocomplete>

      <div className={`${heightClass} rounded-xl overflow-hidden border border-slate-200 relative`}>
        <GoogleMap
          mapContainerStyle={{ width: '100%', height: '100%' }}
          center={marker ?? MUMBAI_CENTER}
          zoom={marker ? 17 : 12}
          onLoad={(m) => { mapRef.current = m }}
          onClick={handleMapClick}
          options={{
            streetViewControl: false,
            mapTypeControl: false,
            fullscreenControl: false,
            clickableIcons: false,
          }}
        >
          {marker && (
            <Marker
              position={marker}
              draggable
              onDragEnd={handleMarkerDragEnd}
            />
          )}
        </GoogleMap>
        {resolving && (
          <div className="absolute top-2 right-2 px-2 py-1 rounded-lg bg-white/90 text-[10px] font-bold text-slate-500 shadow-sm">
            Locating…
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-400">
        {marker
          ? '📍 Drag the pin to fine-tune the exact spot, or search again above.'
          : 'Search an address above, or tap directly on the map to drop a pin.'}
      </p>
    </div>
  )
}