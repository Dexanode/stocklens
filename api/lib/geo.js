// Server-side geo gating for StockLens API routes.
//
// Vercel sets `x-vercel-ip-country` from the request IP on every deployment
// (two-letter ISO country code, e.g. "US"). That header is the only source
// trusted for blocking: the client-sent `x-stocklens-country` header is
// self-declared and can say anything, so it must never be the basis of a
// "blocked" claim on its own (audit C-3).
//
// Local development has no `x-vercel-ip-country` header, so the client header
// is used as a fallback — but only as best-effort self-attestation, never as
// proof of enforcement. See README "Safety and scope".

const BLOCKED_COUNTRIES = new Set(['US'])

function headerCountry(request, name) {
  const value = request?.headers?.[name]
  if (typeof value !== 'string') return ''
  return value.split(',')[0].trim().toUpperCase()
}

export function resolveCountry(request) {
  const serverCountry = headerCountry(request, 'x-vercel-ip-country')
  if (serverCountry) return { country: serverCountry, source: 'vercel-ip' }
  const clientCountry = headerCountry(request, 'x-stocklens-country')
  if (clientCountry) return { country: clientCountry, source: 'client-declared' }
  return { country: 'UNKNOWN', source: 'none' }
}

export function isBlockedCountry(request) {
  const { country, source } = resolveCountry(request)
  return { blocked: BLOCKED_COUNTRIES.has(country), country, source }
}
