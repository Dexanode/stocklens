import { list, put } from '@vercel/blob'
import { fetchLiveNav } from './lib/coinbase.js'
import { blobPath } from './lib/storage.js'
import { readBlobJson, BlobReadError } from './lib/blob-store.js'

// Namespaced per environment (see api/lib/storage.js): production keeps
// stocklens/nav-history.json; preview/development write under
// stocklens/<env>/nav-history.json and can never touch production data.
const PATH = blobPath('stocklens/nav-history.json')
const MAX_POINTS = 260
const MAX_AGE = 366 * 864e5
// B20 universe served by the frontend, verified live 26 Nov 2026:
// AAPLc, AMZNc, ANTc, CRCLc, GOOGLc, INTCc, METAc, MSFTc, MSTRc, NVDAc,
// SNDKc, SPCXc, TSLAc. A symbol outside this list is never recorded, even if
// the live NAV feed lists it — the allowlist is the product's universe.
const ALLOWED_SYMBOLS = new Set([
  'AAPLc', 'AMZNc', 'ANTc', 'CRCLc', 'GOOGLc', 'INTCc', 'METAc',
  'MSFTc', 'MSTRc', 'NVDAc', 'SNDKc', 'SPCXc', 'TSLAc',
])
const MAX_SYMBOLS_PER_REQUEST = 24

// Rev 4: same fail-closed rule as api/thesis.js (see api/lib/blob-store.js).
// The old reader returned {} for ANY read problem, so a POST after a
// transient Blob failure rewrote the history file from {} and wiped every
// stored point. Now only a genuinely missing file is {}; a failed fetch,
// a non-2xx response, broken JSON, or a non-object payload throws
// BlobReadError and the handler answers with an error BEFORE any put().
async function readHistory(token) {
  const { found, value } = await readBlobJson({
    list,
    token,
    path: PATH,
    validate: (payload) => payload !== null && typeof payload === 'object' && !Array.isArray(payload),
    unavailableCode: 'nav_history_store_unavailable',
    corruptCode: 'nav_history_store_corrupt',
  })
  return found ? value : {}
}

// Returns the error response for a store-read failure, or null when the
// error is not a BlobReadError.
function storeErrorResponse(response, error) {
  if (error instanceof BlobReadError) {
    return response.status(error.status).json({ persistent: false, history: {}, error: error.message, code: error.code })
  }
  return null
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
      let history
      try {
        history = await readHistory(token)
      } catch (error) {
        const handled = storeErrorResponse(response, error)
        if (handled) return handled
        throw error
      }
      response.setHeader('Cache-Control', 'no-store')
      return response.status(200).json({ persistent: true, history })
    }

    // POST records a snapshot — but NEVER from a client-supplied price.
    // Review fix, 26 Nov 2026: the first version of this PR validated
    // client prices against live NAV within +/-50%, but a fake price
    // inside that band still lands in the shared history and then feeds
    // the chart and the Portfolio Agent. So client prices are ignored
    // entirely: the server fetches the live NAV itself from Coinbase and
    // records only what it observed. A POST is just a "refresh now"
    // trigger; the optional `symbols` array only narrows which allowlisted
    // symbols are refreshed (default: all 13). The old `snapshots` body
    // is accepted and ignored for backwards compatibility with the
    // deployed frontend, which still sends it fire-and-forget.
    const input = parseBody(request)
    if (input === null) return response.status(400).json({ error: 'Request body is not valid JSON.' })
    const requested = Array.isArray(input.symbols)
      ? input.symbols.map((s) => String(s || '').trim()).filter(Boolean)
      : [...ALLOWED_SYMBOLS]
    if (requested.length > MAX_SYMBOLS_PER_REQUEST) {
      return response.status(400).json({ error: `At most ${MAX_SYMBOLS_PER_REQUEST} symbols per request.` })
    }
    const symbols = [...new Set(requested)]
    const rejected = symbols
      .filter((symbol) => !ALLOWED_SYMBOLS.has(symbol))
      .map((symbol) => ({ symbol, reason: 'symbol not in B20 allowlist' }))
    const wanted = symbols.filter((symbol) => ALLOWED_SYMBOLS.has(symbol))

    // Live NAV observed server-side. Fail closed: if Coinbase is
    // unreachable we cannot observe anything, so nothing is written.
    let liveNav
    try {
      liveNav = await fetchLiveNav()
    } catch {
      return response.status(503).json({ persistent: false, history: {}, error: 'Live NAV reference unavailable; snapshot rejected, nothing was written.' })
    }

    // A failed read must fail the request, not silently become an empty
    // history: the put() below would then overwrite the stored file with
    // only the new points and wipe all previous history. Rev 4.
    let existing
    try {
      existing = await readHistory(token)
    } catch (error) {
      const handled = storeErrorResponse(response, error)
      if (handled) return handled
      throw error
    }
    const now = Date.now()
    const history = { ...existing }
    const accepted = []
    const skipped = []
    for (const symbol of wanted) {
      const price = liveNav.get(symbol)
      if (!Number.isFinite(price) || price <= 0) {
        rejected.push({ symbol, reason: 'no live NAV reference for symbol' })
        continue
      }
      const rows = Array.isArray(history[symbol]) ? history[symbol].filter((row) => now - Number(row.timestamp) <= MAX_AGE) : []
      if (rows.length && now - Number(rows.at(-1).timestamp) < 15 * 60e3) {
        skipped.push(symbol)
        continue
      }
      rows.push({ timestamp: now, price })
      history[symbol] = rows.slice(-MAX_POINTS)
      accepted.push(symbol)
    }
    if (!accepted.length && !skipped.length) {
      response.setHeader('Cache-Control', 'no-store')
      return response.status(400).json({ persistent: false, history: {}, error: 'No valid snapshots in request.', accepted, skipped, rejected })
    }
    if (accepted.length) {
      await put(PATH, JSON.stringify(history), { access: 'private', addRandomSuffix: false, allowOverwrite: true, token, contentType: 'application/json' })
    }
    response.setHeader('Cache-Control', 'no-store')
    return response.status(200).json({ persistent: true, history, accepted, skipped, rejected })
  } catch (error) {
    // Backstop: a store-read failure must never surface as 200 with an
    // empty history (the old behaviour hid the failure from callers).
    if (error instanceof BlobReadError) {
      return response.status(error.status).json({ persistent: false, history: {}, error: error.message, code: error.code })
    }
    return response.status(200).json({ persistent: false, history: {}, warning: error instanceof Error ? error.message : 'Persistent history unavailable' })
  }
}
