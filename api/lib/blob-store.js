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

export async function readBlobJson({
  list,
  fetchImpl = fetch,
  token,
  path,
  validate,
  unavailableCode = 'blob_unavailable',
  corruptCode = 'blob_corrupt',
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
    response = await fetchImpl(blob.url, { headers: { Authorization: `Bearer ${token}` } })
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
