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
//   - file not listed / fetch 404  -> { found: false, value: null }
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

// Thrown when a write was attempted but its effect could not be confirmed
// by a fresh re-read after all retries (rev 6). The handler answers 503
// with this code — never 200 — so a caller can never mistake an
// unconfirmed write for a persisted one.
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
  // A 404 on the fetch means the object vanished between list() and
  // fetch(): treat it like a missing file, not a failure.
  if (response.status === 404) return { found: false, value: null }
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
  return { found: true, value: payload }
}

// Verified read-modify-write (rev 6).
//
// Why this exists: every Blob write in api/ used to be read -> modify in
// memory -> put -> 200, with no check that the write ever became visible
// and no defence against a stale read. Observed live 26 Nov 2026:
//   - a status PUT returned 200 nineteen seconds after its thesis was
//     created, yet GETs a minute later still showed the old status
//     (updatedAt = creation time): the 200 was a lie;
//   - a share POST's record (id th_f4005b18…) never appeared in the
//     store while the save POST's record did: a later PUT read a stale
//     list and wrote it back, silently wiping the newer record.
// The file is overwritten in place under a stable URL, Vercel Blob has no
// versioning / compare-and-swap, and a plain fetch of the URL can serve a
// cached copy — so a bare read-modify-write cannot tell a fresh read from
// a stale one. This helper makes the failure loud instead of silent:
//
//   1. read (fail-closed, rev 4 — a failed read aborts before any write),
//   2. mutate(current) -> next (pure; must be IDEMPOTENT, because a
//      retry re-runs it on a fresher read — e.g. dedup by id/timestamp —
//      and may throw FailRequest to abort with a domain error),
//      or return the SAME reference to signal "already applied, nothing
//      to write" (the read itself is then the confirmation),
//   3. put(next) with cacheControlMaxAge: 0, so the stored object is not
//      served from an edge cache afterwards,
//   4. re-read with a cache-busting URL and run confirm(next, stored):
//      the intended mutation must be present AND nothing the write
//      contained may be missing from the re-read. A mismatch retries
//      the whole cycle (bounded, with backoff); if no attempt confirms,
//      throw BlobWriteError — the handler answers 503, never 200.
//
// What it does NOT promise: without versioning/CAS, two writers racing
// inside the same read window can still overwrite each other (last
// writer wins), and a verify read can only compare against what this
// request itself wrote. The guarantee is narrower and honest: a 200
// means a fresh re-read showed the intended mutation and no loss
// relative to what this request wrote; anything else is a 503.
export async function readModifyWrite({
  list,
  put,
  fetchImpl = fetch,
  token,
  path,
  validate,
  empty,
  unavailableCode = 'blob_unavailable',
  corruptCode = 'blob_corrupt',
  notConfirmedCode = 'blob_not_confirmed',
  mutate,
  confirm,
  maxAttempts = 3,
  backoffMs = 150,
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // A failed read aborts before any write (rev 4 guarantee).
    const { found, value } = await readBlobJson({
      list, fetchImpl, token, path, validate, unavailableCode, corruptCode,
    })
    const current = found ? value : empty
    // FailRequest propagates immediately: invalid request, not a store
    // problem — no put(), no retry.
    const next = mutate(current)
    if (next === current) return current
    let putError = null
    try {
      await put(path, JSON.stringify(next), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        token,
        contentType: 'application/json',
        cacheControlMaxAge: 0,
      })
    } catch (error) {
      putError = error
    }
    if (!putError) {
      try {
        const check = await readBlobJson({
          list, fetchImpl, token, path, validate, unavailableCode, corruptCode, cacheBust: true,
        })
        if (check.found && confirm(next, check.value)) return check.value
      } catch {
        // A failed verify read is "not confirmed", not a success: fall
        // through to retry (or to the BlobWriteError below).
      }
    }
    if (attempt < maxAttempts) {
      await sleep(backoffMs * attempt)
      continue
    }
    throw new BlobWriteError(
      notConfirmedCode,
      503,
      putError
        ? `Blob write to ${path} failed: ${putError instanceof Error ? putError.message : String(putError)}`
        : `Blob write to ${path} could not be confirmed after ${maxAttempts} attempts: the change may not have persisted.`,
    )
  }
  // Unreachable: the loop always returns or throws.
  throw new BlobWriteError(notConfirmedCode, 503, `Blob write to ${path} could not be confirmed.`)
}
