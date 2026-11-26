import { list, get, head, put } from '@vercel/blob'
import { blobPath } from './lib/storage.js'
import { readBlobJson, readModifyWrite, BlobReadError, BlobWriteError, FailRequest } from './lib/blob-store.js'

const PATH = blobPath('stocklens/theses.json')
const MAX_ITEMS = 500

// Rev 4: readTheses either returns the stored array (or [] when the file
// genuinely does not exist yet) or THROWS BlobReadError. It never silently
// returns [] for a failed fetch, a non-2xx response, broken JSON, or a
// non-array payload — those used to be swallowed, so the next POST/PUT
// rewrote the file from [] and wiped every stored thesis. The handler
// answers a BlobReadError with an error status BEFORE any put() is called.
async function readTheses(token) {
  const { found, value } = await readBlobJson({
    list, getImpl: get, headImpl: head,
    token,
    path: PATH,
    validate: Array.isArray,
    unavailableCode: 'thesis_store_unavailable',
    corruptCode: 'thesis_store_corrupt',
  })
  return found ? value : []
}

// Returns the error response for a store-read failure or a failed
// write (put() threw on every attempt), or null when the error is not
// one of those (the outer catch then handles it).
function storeErrorResponse(response, error) {
  if (error instanceof BlobReadError || error instanceof BlobWriteError) {
    return response.status(error.status).json({ persistent: false, error: error.message, code: error.code })
  }
  return null
}

// Maps an error from readModifyWrite to its HTTP response: a domain
// abort (FailRequest) keeps its own status/body, a store failure keeps
// its 503/500 + code, anything else is rethrown to the outer catch.
function writeErrorResponse(response, error) {
  if (error instanceof FailRequest) {
    return response.status(error.status).json(error.body)
  }
  return storeErrorResponse(response, error)
}

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max)
}

function sanitize(input, id) {
  return {
    id,
    symbol: clean(input.symbol, 20),
    assetName: clean(input.assetName, 100),
    title: clean(input.title, 160),
    note: clean(input.note, 1200),
    conviction: Math.min(5, Math.max(1, Number(input.conviction) || 3)),
    status: ['OPEN', 'MONITORING', 'INVALIDATED', 'CLOSED'].includes(input.status) ? input.status : 'OPEN',
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    entryPrice: clean(input.entryPrice, 40),
    entryPriceValue: Number.isFinite(Number(input.entryPriceValue)) ? Number(input.entryPriceValue) : null,
    score: Number.isFinite(Number(input.score)) ? Number(input.score) : null,
    risk: clean(input.risk, 40),
    change: clean(input.change, 40),
    target: input.target === null || input.target === undefined ? null : Number(input.target),
    source: clean(input.source, 80),
    lastReviewedAt: input.lastReviewedAt || null,
    lastReviewedPrice: input.lastReviewedPrice || null,
    reviewCount: Math.max(0, Number(input.reviewCount) || 0),
  }
}

// The public view of a thesis: everything a share-link holder may see.
// The editToken is NEVER included here — it is returned only once, in the
// POST response that creates the thesis, and the creator's browser keeps it
// in localStorage. `editable` tells a reader whether the record has an
// owner token at all (false = legacy thesis, read-only on the server).
function publicThesis(record) {
  const { editToken, ...rest } = record
  return { ...rest, editable: Boolean(editToken) }
}

// A thesis is empty when it has no symbol, no title, and no note at all.
// This is the check that stops a repeat of the empty thesis created during
// the 26 Nov audit via POST {} (id th_68e55fb6-1cc4-4b2b-b8fd-f60d459e9539).
function hasContent(thesis) {
  return [thesis.symbol, thesis.title, thesis.note].some((value) => String(value || '').trim().length > 0)
}

function parseBody(request) {
  try {
    return typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {}
  } catch {
    return null
  }
}

// How the GET branch finds the thesis id (rev 5).
//
// Root cause of the live 404s on 26 Nov 2026: the old GET read the id ONLY
// from `request.query?.id`. On the preview deployment that never saw the id
// — GET /api/thesis?id=th_f4005b18-... returned 404 six times over ~8 min
// (14:22:45–14:30:39) while PUT with the SAME id in the JSON body returned
// 200 twice, so the record provably existed and the id was provably right;
// the id simply never reached the lookup. The frontend is exonerated:
// it fetches `/api/thesis?id=<serverId>` (src/main.jsx) and the share link
// carries the server id from the POST response, so the sent id was correct.
// So parse the query string from the raw request URL ourselves instead of
// trusting the runtime to populate `request.query`, and accept `thesisId`
// as an alias (the page's own share links use ?thesisId=). `request.query`
// stays as a fallback for runtimes that do populate it.
//
// The old GET also answered `Cache-Control: public, max-age=30,
// stale-while-revalidate=300` — a cached 404 for a just-created thesis can
// be served stale for minutes, and a query-insensitive edge cache key would
// serve one id's 404 for every id. Single-thesis GET is now `no-store`.
function queryId(request) {
  const raw = typeof request.url === 'string' ? request.url : ''
  if (raw) {
    try {
      const parsed = new URL(raw.startsWith('http') ? raw : `http://localhost${raw.startsWith('/') ? raw : `/${raw}`}`)
      const fromUrl = parsed.searchParams.get('id') || parsed.searchParams.get('thesisId')
      if (fromUrl) return fromUrl
    } catch {
      // Fall through to request.query below.
    }
  }
  const query = request.query || {}
  const fromQuery = query.id ?? query.thesisId
  return Array.isArray(fromQuery) ? fromQuery[0] : fromQuery
}

export default async function handler(request, response) {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) return response.status(503).json({ persistent: false, error: 'BLOB_READ_WRITE_TOKEN is not configured.' })
  try {
    if (request.method === 'GET') {
      // A failed read must fail the request, not silently become an empty
      // store (rev 4).
      let theses
      try {
        theses = await readTheses(token)
      } catch (error) {
        const handled = storeErrorResponse(response, error)
        if (handled) return handled
        throw error
      }
      const id = clean(queryId(request), 100)
      if (!id) {
        // List view: every stored thesis in public form (no edit tokens).
        // The pre-PR handler returned the list here; rev 1–4 returned 404
        // for a missing id, which also meant a plain GET could never list.
        response.setHeader('Cache-Control', 'no-store')
        return response.status(200).json({ persistent: true, theses: theses.map(publicThesis) })
      }
      const thesis = theses.find((item) => item.id === id)
      if (!thesis) return response.status(404).json({ persistent: true, error: 'Thesis not found.' })
      response.setHeader('Cache-Control', 'no-store')
      return response.status(200).json({ persistent: true, thesis: publicThesis(thesis) })
    }
    // No DELETE endpoint by design (review fix, 26 Nov 2026): thesis ids
    // appear in public share links (?thesisId=), so anyone holding a link
    // could delete someone else's thesis and there is no ownership model
    // (no accounts, no recorded creator) to check against. The UI has no
    // delete button either, so a public DELETE would be pure attack
    // surface. Deletion is owner-only via the Vercel Blob dashboard
    // (Storage -> Blob -> stocklens/theses.json, remove the entry) — that
    // is also how the empty audit thesis th_68e55fb6… is removed.
    if (request.method !== 'POST' && request.method !== 'PUT') return response.status(405).json({ error: 'Method not allowed.' })
    const input = parseBody(request)
    if (input === null) return response.status(400).json({ error: 'Request body is not valid JSON.' })

    if (request.method === 'POST') {
      // The server assigns the id and the edit token; anything the client
      // sends for `id` or `editToken` is ignored, so a caller cannot plant
      // a known id or a known token. The id/token are fixed BEFORE the
      // write loop so a retry re-uses them instead of minting a second
      // record (rev 6: mutate must be idempotent).
      const id = `th_${crypto.randomUUID()}`
      const editToken = crypto.randomUUID()
      const next = { ...sanitize(input, id), editToken }
      if (!hasContent(next)) return response.status(400).json({ error: 'Thesis requires at least a symbol, title, or note.' })
      // Rev 7: put() succeeding IS the write (rev 6's verify-as-gate
      // returned false 503s for writes that had landed, because Blob
      // reads lag writes by ~10–25 s). The response carries the record
      // as written, the edit token, and a `verified` flag: a fresh
      // re-read has (true) or has not yet (false) seen the change.
      // `verified: false` is a normal outcome under propagation lag —
      // the record is stored, the UI just re-fetches later.
      let written
      let writeVerified = false
      try {
        ({ value: written, verified: writeVerified } = await readModifyWrite({
          list, getImpl: get, headImpl: head, put, token, path: PATH,
          validate: Array.isArray, empty: [],
          unavailableCode: 'thesis_store_unavailable',
          corruptCode: 'thesis_store_corrupt',
          writeFailedCode: 'thesis_store_write_failed',
          mutate: (theses) => {
            if (theses.some((item) => item.id === id)) return theses
            return [next, ...theses].slice(0, MAX_ITEMS)
          },
          confirm: (written, stored) => {
            const created = stored.find((item) => item.id === id)
            if (!created || created.editToken !== editToken) return false
            return written.every((item) => stored.some((row) => row.id === item.id))
          },
        }))
      } catch (error) {
        const handled = writeErrorResponse(response, error)
        if (handled) return handled
        throw error
      }
      const created = written.find((item) => item.id === id)
      if (!created) throw new Error('Thesis write did not include the new record.')
      response.setHeader('Cache-Control', 'no-store')
      // The editToken is returned ONLY here, once, at creation. It is
      // never in a GET response, never in a PUT response, and never in a
      // share link (?thesisId= carries the id only).
      return response.status(200).json({ persistent: true, thesis: publicThesis(created), editToken, verified: writeVerified, pendingPropagation: !writeVerified })
    }

    // PUT: proof of ownership via the x-edit-token header.
    const id = clean(input.id, 100)
    if (!id) return response.status(400).json({ error: 'Missing thesis id.' })
    const supplied = clean(request.headers?.['x-edit-token'], 200)
    // The merged record is computed once, before the write loop, so a
    // retry re-applies the identical change (mutate must stay idempotent).
    // The ownership checks run inside mutate on every attempt, against
    // the freshest read, and abort with FailRequest (no write, no retry).
    const sanitized = sanitize(input, id)
    let merged = null
    let written
    let writeVerified = false
    try {
      ({ value: written, verified: writeVerified } = await readModifyWrite({
        list, getImpl: get, headImpl: head, put, token, path: PATH,
        validate: Array.isArray, empty: [],
        unavailableCode: 'thesis_store_unavailable',
        corruptCode: 'thesis_store_corrupt',
        writeFailedCode: 'thesis_store_write_failed',
        mutate: (theses) => {
          // PUT must only update a thesis that already exists. It never
          // creates one: previously a PUT with a new id silently inserted
          // a thesis, so anyone who knew (or guessed) an id could plant
          // content (audit C-1).
          const index = theses.findIndex((item) => item.id === id)
          if (index < 0) throw new FailRequest(404, { persistent: true, error: 'Thesis not found.' })
          const existing = theses[index]
          // Legacy theses (created before edit tokens existed) carry no
          // owner proof at all — no creator address, no token, nothing
          // to verify against. Claiming ownership cryptographically is
          // impossible, so they are read-only on the server instead of
          // staying overwritable by anyone with the share link. The owner
          // keeps the local copy in their workspace and can "Duplicate
          // as new" in the UI to get an editable copy with a fresh token;
          // the legacy record stays visible and shareable.
          if (!existing.editToken) {
            throw new FailRequest(410, { persistent: true, error: 'This thesis was created before edit tokens and is read-only on the server. Duplicate it as a new thesis to edit it.', code: 'thesis_legacy_read_only', legacy: true })
          }
          if (!supplied) throw new FailRequest(401, { error: 'Missing edit token. Send the x-edit-token header issued at creation.', code: 'edit_token_required' })
          if (supplied !== existing.editToken) throw new FailRequest(401, { error: 'Edit token does not match this thesis.', code: 'edit_token_mismatch' })
          merged = { ...existing, ...sanitized, editToken: existing.editToken }
          if (!hasContent(merged)) throw new FailRequest(400, { error: 'Thesis requires at least a symbol, title, or note.' })
          const out = [...theses]
          out[index] = merged
          return out
        },
        confirm: (written, stored) => {
          const row = stored.find((item) => item.id === id)
          if (!row || row.status !== merged.status || row.updatedAt !== merged.updatedAt || row.reviewCount !== merged.reviewCount || row.editToken !== merged.editToken) return false
          return written.every((item) => stored.some((r) => r.id === item.id))
        },
      }))
    } catch (error) {
      const handled = writeErrorResponse(response, error)
      if (handled) return handled
      throw error
    }
    // Rev 7: the response carries the record as written (put()
    // succeeded), plus a `verified` flag for whether a fresh re-read
    // has already seen it. The frontend adopts this as the source of
    // truth; on `pendingPropagation` it re-fetches later instead of
    // assuming the change is visible yet.
    const persisted = written.find((item) => item.id === id)
    if (!persisted) throw new Error('Thesis write did not include the updated record.')
    response.setHeader('Cache-Control', 'no-store')
    return response.status(200).json({ persistent: true, thesis: publicThesis(persisted), verified: writeVerified, pendingPropagation: !writeVerified })
  } catch (error) {
    return response.status(500).json({ persistent: false, error: error instanceof Error ? error.message : 'Thesis persistence unavailable.' })
  }
}
