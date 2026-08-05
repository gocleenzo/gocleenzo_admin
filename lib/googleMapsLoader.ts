// lib/googleMapsLoader.ts
//
// @react-google-maps/api's loader is a SINGLETON per browser session — every
// component that calls useJsApiLoader (or useLoadScript) must pass the
// EXACT same options object shape (same id, same libraries, etc), or you
// get: "Loader must not be called again with different options."
//
// This happened because different admin pages each defined their own
// slightly different config (different `id` values) — fine in isolation,
// but once Next.js client-side-navigates from one page to another without
// a full reload, both configs try to coexist and the library throws.
//
// Fix: every component that needs Google Maps imports THIS exact object
// and passes it straight into useJsApiLoader. Never define a new/separate
// options object elsewhere.

export const GOOGLE_MAPS_LOADER_OPTIONS = {
  id: 'cleenzo-admin-google-maps',
  googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
} as const