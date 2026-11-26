// Unit tests for api/lib/blob-store.js — the fail-closed Blob read layer
// (rev 4). No network, no @vercel/blob: list() and fetch are injected fakes.
// Run: node --test tests/blob-store.test.mjs   (or: node --test tests/)
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readBlobJson, BlobReadError } from '../api/lib/blob-store.js'

const PATH = 'stocklens/theses.json'
const TOKEN = 'test-token'

function fakeFetch({ ok = true, status = 200, jsonValue = null, jsonThrows = false, throws = null } = {}) {
  return async () => {
    if (throws) throw throws
    return {
      ok,
      status,
      json: async () => {
        if (jsonThrows) throw new SyntaxError('Unexpected token in JSON')
        return jsonValue
      },
    }
  }
}

function listWith(blobs) {
  return async () => ({ blobs })
}

const BLOB_ENTRY = { pathname: PATH, url: 'https://blob.test/theses.json' }

describe('readBlobJson', () => {
  it('file genuinely missing (not listed) -> { found: false } so a write may proceed', async () => {
    const result = await readBlobJson({ list: listWith([]), fetchImpl: fakeFetch(), token: TOKEN, path: PATH })
    assert.deepEqual(result, { found: false, value: null })
  })

  it('list() throwing -> BlobReadError blob_unavailable, 503', async () => {
    const list = async () => { throw new Error('network down') }
    await assert.rejects(
      () => readBlobJson({ list, fetchImpl: fakeFetch(), token: TOKEN, path: PATH }),
      (error) => error instanceof BlobReadError && error.code === 'blob_unavailable' && error.status === 503,
    )
  })

  it('fetch throwing (network error) -> blob_unavailable, 503', async () => {
    await assert.rejects(
      () => readBlobJson({ list: listWith([BLOB_ENTRY]), fetchImpl: fakeFetch({ throws: new Error('ECONNRESET') }), token: TOKEN, path: PATH }),
      (error) => error instanceof BlobReadError && error.code === 'blob_unavailable' && error.status === 503,
    )
  })

  it('fetch non-2xx (500) -> blob_unavailable, 503', async () => {
    await assert.rejects(
      () => readBlobJson({ list: listWith([BLOB_ENTRY]), fetchImpl: fakeFetch({ ok: false, status: 500 }), token: TOKEN, path: PATH }),
      (error) => error instanceof BlobReadError && error.code === 'blob_unavailable' && error.status === 503,
    )
  })

  it('a listed object returning 404 fails closed', async () => {
    await assert.rejects(
      () => readBlobJson({ list: listWith([BLOB_ENTRY]), fetchImpl: fakeFetch({ ok: false, status: 404 }), token: TOKEN, path: PATH }),
      (error) => error instanceof BlobReadError && error.status === 503,
    )
  })

  it('broken JSON -> BlobReadError blob_corrupt, 500', async () => {
    await assert.rejects(
      () => readBlobJson({ list: listWith([BLOB_ENTRY]), fetchImpl: fakeFetch({ jsonThrows: true }), token: TOKEN, path: PATH }),
      (error) => error instanceof BlobReadError && error.code === 'blob_corrupt' && error.status === 500,
    )
  })

  it('valid JSON but failing shape validation -> blob_corrupt, 500', async () => {
    await assert.rejects(
      () => readBlobJson({
        list: listWith([BLOB_ENTRY]),
        fetchImpl: fakeFetch({ jsonValue: { not: 'an array' } }),
        token: TOKEN,
        path: PATH,
        validate: Array.isArray,
      }),
      (error) => error instanceof BlobReadError && error.code === 'blob_corrupt' && error.status === 500,
    )
  })

  it('valid JSON passing validation -> { found: true, value }', async () => {
    const stored = [{ id: 'th_1', symbol: 'AAPLc' }]
    const result = await readBlobJson({
      list: listWith([BLOB_ENTRY]),
      fetchImpl: fakeFetch({ jsonValue: stored }),
      token: TOKEN,
      path: PATH,
      validate: Array.isArray,
    })
    assert.deepEqual(result, { found: true, value: stored, etag: null })
  })

  it('custom error codes are honoured (thesis endpoint codes)', async () => {
    await assert.rejects(
      () => readBlobJson({
        list: listWith([BLOB_ENTRY]),
        fetchImpl: fakeFetch({ jsonThrows: true }),
        token: TOKEN,
        path: PATH,
        unavailableCode: 'thesis_store_unavailable',
        corruptCode: 'thesis_store_corrupt',
      }),
      (error) => error instanceof BlobReadError && error.code === 'thesis_store_corrupt' && error.status === 500,
    )
  })
})
