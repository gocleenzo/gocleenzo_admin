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
// (and, if it needs Places Autocomplete, this exact GOOGLE_MAPS_LIBRARIES
// array too) and passes it straight into useJsApiLoader. Never define a
// new/separate options object OR a new inline libraries array elsewhere —
// even a *new array instance* with the same string contents is a
// different reference and will trip the same "different options" error,
// which is why this is exported as one stable module-level constant
// rather than created inline wherever it's used.
//
// UPDATED: added the 'places' library — needed for the new address
// search/autocomplete map picker (used when creating/editing a phone
// booking's address). assign_map.tsx doesn't use Places itself, but
// loading an extra library it doesn't need is harmless; NOT loading a
// library a different component on the same page DOES need is what
// breaks things.

export const GOOGLE_MAPS_LIBRARIES: ('places')[] = ['places']

export const GOOGLE_MAPS_LOADER_OPTIONS = {
  id: 'cleenzo-admin-google-maps',
  googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
  libraries: GOOGLE_MAPS_LIBRARIES,
} as const