import { list, put } from '@vercel/blob'
import { fetchLiveNav } from './lib/coinbase.js'

const PATH = 'stocklens/nav-history.json'
const MAX_POINTS = 260
const MAX_AGE = 366 * 864e5
// B20 universe served by the frontend, verified live 26 Nov 2026:
// AAPLc, AMZNc, ANTc, CRCLc, GOOGLc, INTCc, METAc, MSFTc, MSTRc, NVDAc,
// SNDKc, SPCXc, TSLAc. A symbol outside this list is never accepted, even if
// the live NAV feed lists it — the allowlist is the product's universe.
const ALLOWED_SYMBOLS = new Set([
  'AAPLc', 'AMZNc', 'ANTc', 'CRCLc', 'GOOGLc', 'INTCc', 'METAc',
  'MSFTc', 'MSTRc', 'NVDAc', 'SNDKc', 'SPCXc', 'TSLAc',
])
const MAX_SYMBOLS_PER_REQUEST = 24
// A snapshot is only plausible if it is within +/-50% of the live NAV print
// from the same Coinbase feed the market route uses. Anything outside that
// band is rejected and never stored (audit C-1).
const PRICE_BAND = 0.5

async function readHistory(token) {
  const result = await list({ prefix: PATH, token })
  const blob = result.blobs.find((item) => item.pathname === PATH)
  if (!blob) return {}
  const response = await fetch(blob.url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) return {}
  return await response.json()
}

function parseBody(request) {
  try {
    return typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {}
  } catch {
    return null
  }
}

export default async function handler(request, response) {
  // GET is read-only: it must NEVER write to Blob. Previously every request,
  // including GET, rewrote the whole history file (audit C-1).
  if (request.method !== 'GET' && request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed.' })
  }
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) return response.status(200).json({ persistent: false, history: {}, warning: 'BLOB_READ_WRITE_TOKEN is not configured.' })
  try {
    if (request.method === 'GET') {
      const history = await readHistory(token)
      response.setHeader('Cache-Control', 'no-store')
      return response.status(200).json({ persistent: true, history })
    }

    const input = parseBody(request)
    if (input === null) return response.status(400).json({ error: 'Request body is not valid JSON.' })
    const snapshots = input.snapshots && typeof input.snapshots === 'object' ? input.snapshots : {}
    const entries = Object.entries(snapshots)
    if (entries.length > MAX_SYMBOLS_PER_REQUEST) {
      return response.status(400).json({ error: `At most ${MAX_SYMBOLS_PER_REQUEST} symbols per request.` })
    }
    // Live NAV reference for price validation. Fail closed: if Coinbase is
    // unreachable we cannot validate prices, so nothing is written this cycle.
    let liveNav
    try {
      liveNav = await fetchLiveNav()
    } catch {
      return response.status(503).json({ persistent: false, history: {}, error: 'Live NAV reference unavailable; snapshot rejected, nothing was written.' })
    }

    const existing = await readHistory(token)
    const now = Date.now()
    const history = { ...existing }
    const accepted = []
    const rejected = []
    for (const [symbol, raw] of entries) {
      const price = Number(raw?.price)
      if (!ALLOWED_SYMBOLS.has(symbol)) {
        rejected.push({ symbol, reason: 'symbol not in B20 allowlist' })
        continue
      }
      if (!Number.isFinite(price) || price <= 0) {
        rejected.push({ symbol, reason: 'price must be a positive number' })
        continue
      }
      const reference = liveNav.get(symbol)
      if (!Number.isFinite(reference)) {
        rejected.push({ symbol, reason: 'no live NAV reference for symbol' })
        continue
      }
      if (Math.abs(price - reference) / reference > PRICE_BAND) {
        rejected.push({ symbol, reason: `price outside +/-${PRICE_BAND * 100}% of live NAV ($${reference.toFixed(2)})` })
        continue
      }
      const rows = Array.isArray(history[symbol]) ? history[symbol].filter((row) => now - Number(row.timestamp) <= MAX_AGE) : []
      if (!rows.length || now - Number(rows.at(-1).timestamp) >= 15 * 60e3) rows.push({ timestamp: now, price })
      history[symbol] = rows.slice(-MAX_POINTS)
      accepted.push(symbol)
    }
    if (!accepted.length) {
      response.setHeader('Cache-Control', 'no-store')
      return response.status(400).json({ persistent: false, history: {}, error: 'No valid snapshots in request.', accepted, rejected })
    }
    await put(PATH, JSON.stringify(history), { access: 'private', addRandomSuffix: false, allowOverwrite: true, token, contentType: 'application/json' })
    response.setHeader('Cache-Control', 'no-store')
    return response.status(200).json({ persistent: true, history, accepted, rejected })
  } catch (error) {
    return response.status(200).json({ persistent: false, history: {}, warning: error instanceof Error ? error.message : 'Persistent history unavailable' })
  }
}
