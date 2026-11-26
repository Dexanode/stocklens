// Shared Blob read layer (rev 4, 26 Nov 2026).
//
// Problem it fixes: every Blob reader in api/ used to treat ANY read
// problem as "file does not exist yet" — a failed fetch, a non-2xx
// response, broken JSON, or a wrongly shaped payload all collapsed to an
// empty store ([] / {}). The next POST/PUT then wrote that empty store
// back with put(), silently wiping every record that was already stored.
// A transient Blob outage could therefore delete all theses / NAV history.
//
// Rule now: only a genuinely missing file is "empty". Everything else
// throws BlobReadError and the handler must answer with an error status
// BEFORE any put() is called, so a failed read can never cause a write.
//
//   - file not listed -> { found: false, value: null }
//     (caller treats this as an empty store; writing is allowed)
//   - list() throws, fetch throws, fetch non-2xx (other than 404)
//     -> BlobReadError, code <unavailableCode>, status 503
//   - response.json() throws, or validate(payload) is false
//     -> BlobReadError, code <corruptCode>, status 500
//
// The layer is dependency-injected (list / fetchImpl) so tests can drive
// every failure mode without @vercel/blob or the network:
// tests/blob-store.test.mjs (unit) and tests/*-blob-failure.test.mjs
// (handler integration, asserting put() is never called on failure).

export class BlobReadError extends Error {
  constructor(code, status, message) {
    super(message)
    this.name = 'BlobReadError'
    this.code = code
    this.status = status
  }
}

// Thrown when a write's put() itself fails on every attempt (rev 7).
// A successful put() is never this error: rev 6 also threw it when a
// verify re-read could not see a landed write, which produced false
// 503s live (a POST returned 503 for a thesis that WAS stored, so the
// UI never received the edit token and the thesis became uneditable).
// That is gone: put() succeeding is the write succeeding, and whether
// a fresh re-read has already seen the change is reported separately
// as `verified` (see readModifyWrite), never as a 503.
export class BlobWriteError extends Error {
  constructor(code, status, message) {
    super(message)
    this.name = 'BlobWriteError'
    this.code = code
    this.status = status
  }
}

// Thrown by a mutate() to abort the write with a domain error (400/401/
// 404/410). Carries the HTTP status and the JSON body the handler should
// answer with. readModifyWrite propagates it immediately: no put(), no
// retry — the request is invalid, not the store.
export class FailRequest extends Error {
  constructor(status, body) {
    super(typeof body?.error === 'string' ? body.error : 'Request failed.')
    this.name = 'FailRequest'
    this.status = status
    this.body = body
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Appends a unique query to a Blob download URL so an edge cache cannot
// serve a stale copy of the file for it. Vercel Blob download URLs accept
// query parameters (e.g. ?download=1); an unknown parameter is ignored by
// the object lookup and only changes the cache key.
function withCacheBust(url) {
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}v=${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export async function readBlobJson({
  list,
  getImpl,
  headImpl,
  fetchImpl = fetch,
  token,
  path,
  validate,
  unavailableCode = 'blob_unavailable',
  corruptCode = 'blob_corrupt',
  cacheBust = false,
}) {
  let result
  try {
    result = await list({ prefix: path, token })
  } catch (error) {
    throw new BlobReadError(
      unavailableCode,
      503,
      `Blob list failed for ${path}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const blobs = Array.isArray(result?.blobs) ? result.blobs : []
  const blob = blobs.find((item) => item?.pathname === path)
  if (!blob) return { found: false, value: null }

  if (getImpl) {
    let result
    let before
    let after
    try {
      before = await headImpl(path, { token })
      result = await getImpl(path, { access: 'private', token, useCache: false })
      after = await headImpl(path, { token })
    } catch (error) {
      throw new BlobReadError(unavailableCode, 503, `Blob read failed for ${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!result || result.statusCode !== 200 || !result.stream) {
      throw new BlobReadError(unavailableCode, 503, `Listed blob could not be read for ${path}.`)
    }
    if (!before?.etag || before.etag !== after?.etag) {
      throw new BlobReadError(unavailableCode, 503, `Blob version changed while reading ${path}; retry.`)
    }
    let payload
    try {
      payload = JSON.parse(await new Response(result.stream).text())
    } catch {
      throw new BlobReadError(corruptCode, 500, `Blob content for ${path} is not valid JSON.`)
    }
    if (validate && !validate(payload)) {
      throw new BlobReadError(corruptCode, 500, `Blob content for ${path} failed shape validation.`)
    }
    return { found: true, value: payload, etag: before.etag }
  }

  let response
  try {
    // Rev 6: the stored file is overwritten in place under a stable URL,
    // and a plain fetch of that URL can return a minutes-old cached copy
    // (observed live 26 Nov 2026: a PUT returned 200 while later GETs
    // still showed the pre-PUT state, and a share POST's record vanished
    // after a later PUT read a stale list). Ask for a fresh copy on every
    // read (`cache: 'no-store'`), and use a cache-busting query on the
    // confirm re-read so a stale edge copy can never confirm a write.
    const url = cacheBust ? withCacheBust(blob.url) : blob.url
    response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  } catch (error) {
    throw new BlobReadError(
      unavailableCode,
      503,
      `Blob fetch failed for ${path}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  // A listed object returning 404 is an inconsistent read, not proof
  // that the store is empty. Never overwrite existing data in this case.
  if (!response.ok) {
    throw new BlobReadError(
      unavailableCode,
      503,
      `Blob fetch for ${path} returned HTTP ${response.status}.`,
    )
  }
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new BlobReadError(corruptCode, 500, `Blob content for ${path} is not valid JSON.`)
  }
  if (validate && !validate(payload)) {
    throw new BlobReadError(corruptCode, 500, `Blob content for ${path} failed shape validation.`)
  }
  const etag = response.headers?.get?.('etag') || null
  return { found: true, value: payload, etag }
}

// Freshness score for a stored snapshot: [newest record timestamp, record
// count]. Every mutation bumps `updatedAt` (theses) or appends a newer
// `timestamp` (NAV history points), so a snapshot with a newer max
// timestamp is fresher; the count only breaks ties. A genuinely missing
// file scores [0, 0]. This is a heuristic, not a version: two snapshots
// with equal timestamps but different content cannot be ordered, and a
// stale snapshot can still win if every read in the window is stale —
// the caller must not treat "freshest of N reads" as "current".
function defaultFreshness(value) {
  let maxTs = 0
  let count = 0
  const scan = (row) => {
    if (!row || typeof row !== 'object') return
    count++
    for (const key of ['updatedAt', 'timestamp', 'createdAt']) {
      const ts = Date.parse(row[key])
      if (Number.isFinite(ts) && ts > maxTs) maxTs = ts
    }
  }
  if (Array.isArray(value)) value.forEach(scan)
  else if (value && typeof value === 'object') {
    for (const rows of Object.values(value)) if (Array.isArray(rows)) rows.forEach(scan)
  }
  return [maxTs, count]
}

function fresher(a, b) {
  // Strictly-greater wins, so identical snapshots keep the first one read.
  return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])
}

// Read-modify-write with honest, lag-aware semantics (rev 7).
//
// Why rev 6 was wrong: it treated a successful put() as unproven until
// a fresh re-read showed the mutation, and answered 503 otherwise. Live
// on the 26 Nov 2026 preview, Blob reads lag writes by ~10–25 s (a GET
// of a just-created id 404'd at +24 s and returned 200 at +40 s), so
// the verify re-read routinely missed a write that had landed:
//   - POST /api/thesis returned 503 for th_a3aa861e…, which WAS in the
//     store — the UI never received the edit token, so no PUT was ever
//     sent (0 PUTs in the function logs) and the thesis was stored but
//     uneditable from the UI;
//   - a share GET-verify 404'd on a stale read and re-created the
//     thesis, storing the same thesis twice.
// A re-read can therefore never be the gate for a write's success: the
// read side is the lagging side. The put() call is the success signal.
//
// Rev 7 contract — returns { value, verified }:
//   1. read, fail-closed (rev 4), but read up to `readAttempts` times
//      with a short backoff and keep the FRESHEST snapshot (highest max
//      timestamp, then record count). This defeats a minutes-old
//      edge-cached copy and a list() that has not caught up with a
//      recent write; it cannot defeat storage propagation lag — that is
//      stated honestly below. A read that fails on every attempt throws
//      BlobReadError before any write.
//   2. mutate(current) -> next (pure; must be IDEMPOTENT, because a
//      retry after a put that threw re-runs it on a fresher read —
//      e.g. dedup by id/timestamp — and may throw FailRequest to abort
//      with a domain error), or the SAME reference to signal "already
//      applied, nothing to write".
//   3. put(next) with cacheControlMaxAge: 0. A put() that throws
//      retries the whole cycle (bounded); if every put throws, throw
//      BlobWriteError — the handler answers 503. A put() that succeeds
//      IS the write: the handler answers 200 with the record as written
//      (plus the edit token on POST) and `verified` / `pendingPropagation`.
//   4. soft verify (best effort, never a gate): after a successful
//      put, re-read on a bounded schedule (default offsets [0, 500,
//      1500, 3500] ms — ~3.5 s worst case, far inside the 30 s function
//      limit) and run confirm(next, stored). The outcome is reported as
//      `verified` so the caller knows whether a fresh re-read has
//      already seen the change; `verified: false` is a normal outcome
//      under propagation lag, not an error, and the UI re-fetches later
//      instead of assuming the write is visible yet. It NEVER turns a
//      landed write into a 503.
//
// What it does NOT promise: without versioning/CAS, two writers racing
// inside the same read window can still overwrite each other (last
// writer wins), and the freshest-of-N-reads heuristic can still lose to
// a read window where every read is stale. The guarantees are narrower
// and honest: a 200 means put() succeeded (the record is in the store);
// a 503 means put() itself failed or the pre-write read failed
// outright; `verified` tells the caller whether a fresh re-read has
// already seen the change.
export async function readModifyWrite({
  list,
  getImpl,
  headImpl,
  put,
  fetchImpl = fetch,
  token,
  path,
  validate,
  empty,
  unavailableCode = 'blob_unavailable',
  corruptCode = 'blob_corrupt',
  writeFailedCode = 'blob_write_failed',
  mutate,
  confirm,
  maxAttempts = 3,
  backoffMs = 150,
  readAttempts = 3,
  freshness = defaultFreshness,
  verifyDelaysMs = [0, 500, 1500, 3500],
}) {
  const readOpts = { list, getImpl, headImpl, fetchImpl, token, path, validate, unavailableCode, corruptCode }

  // 1. Pre-write read, repeated: keep the freshest snapshot seen.
  // A throwing read is retried; only if every attempt fails does the
  // error escape (fail-closed, rev 4 — no write on a failed read).
  async function readFreshest() {
    let best = null
    let bestScore = null
    let lastError = null
    for (let i = 0; i < readAttempts; i++) {
      if (i > 0) await sleep(backoffMs)
      try {
        const result = await readBlobJson({ ...readOpts, cacheBust: i > 0 })
        const value = result.found ? result.value : empty
        const score = freshness(value)
        if (best === null || fresher(score, bestScore)) { best = { value, found: result.found, etag: result.etag }; bestScore = score }
      } catch (error) {
        lastError = error
      }
    }
    if (best === null || (!best.found && lastError)) throw lastError
    return best
  }

  // 4. Soft verify: best effort only. A put() that returned is the
  // success; this only reports whether the change is already visible
  // to a fresh re-read. Delays are absolute offsets from the put.
  async function softVerify(next) {
    if (typeof confirm !== 'function') return true
    for (let i = 0; i < verifyDelaysMs.length; i++) {
      if (i > 0) await sleep(verifyDelaysMs[i] - verifyDelaysMs[i - 1])
      try {
        const check = await readBlobJson({ ...readOpts, cacheBust: true })
        if (check.found && confirm(next, check.value)) return true
      } catch {
        // A failed verify read is "not visible yet", not a failure.
      }
    }
    return false
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // A failed read aborts before any write (rev 4 guarantee).
    const snapshot = await readFreshest()
    const current = snapshot.value
    if (snapshot.found && !snapshot.etag) {
      throw new BlobReadError(unavailableCode, 503, `Blob read for ${path} did not include an ETag; refusing an unsafe write.`)
    }
    // FailRequest propagates immediately: invalid request, not a store
    // problem — no put(), no retry.
    const next = mutate(current)
    if (next === current) return { value: current, verified: true }
    try {
      await put(path, JSON.stringify(next), {
        access: 'private',
        addRandomSuffix: false,
        ...(snapshot.found ? { ifMatch: snapshot.etag } : { allowOverwrite: false }),
        token,
        contentType: 'application/json',
        cacheControlMaxAge: 0,
      })
    } catch (error) {
      if (attempt < maxAttempts) {
        await sleep(backoffMs * attempt)
        continue
      }
      throw new BlobWriteError(
        writeFailedCode,
        503,
        `Blob write to ${path} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    // put() succeeded: that IS the write. Report whether a fresh
    // re-read has already seen it; never 503 for a landed write.
    const verified = await softVerify(next)
    return { value: next, verified }
  }
  // Unreachable: the loop always returns or throws.
  throw new BlobWriteError(writeFailedCode, 503, `Blob write to ${path} failed.`)
}
