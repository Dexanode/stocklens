// Handler integration tests for api/thesis.js (rev 4).
//
// Proves the rev 4 guarantee end-to-end through the real handler: when the
// Blob store cannot be read (list/fetch failure, non-2xx, broken JSON,
// wrong shape), POST/PUT/GET fail with an error status AND put() is never
// called — so previously stored theses can never be wiped by a failed read.
// Only a genuinely missing file (list finds no blob) allows a write.
//
// Run: node --test tests/thesis-blob-failure.test.mjs  (or: node --test tests/)
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { loadHandler, fakeRequest, fakeResponse } from './handler-sandbox.mjs'

process.env.BLOB_READ_WRITE_TOKEN = 'test-token'

const EXISTING = [
  { id: 'th_old', symbol: 'AAPLc', title: 'Old thesis', note: 'keep me', conviction: 4, status: 'OPEN', editToken: 'tok-1' },
]

// list() that finds the stored file; the handler fetches its content via
// global fetch, which each test controls.
function listFindsFile() {
  return async (opts) => ({ blobs: [{ pathname: opts.prefix, url: 'https://blob.test/theses.json' }] })
}

function blobFetch({ ok = true, status = 200, jsonValue = EXISTING, jsonThrows = false, throws = null } = {}) {
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

let handler
let stub
let cleanup

before(async () => {
  ;({ handler, stub, cleanup } = await loadHandler('thesis.js'))
})

after(async () => {
  await cleanup()
})

describe('thesis handler: failed Blob read must never cause a write', () => {
  it('POST creates a thesis when the store file genuinely does not exist', async () => {
    // Rev 6: the verify re-read must see the file the put just wrote, so
    // list() reports the file once a put has happened and fetch reflects
    // it; the initial read still sees a genuinely missing file.
    stub.list = async (opts) => stub.putCalls.length
      ? { blobs: [{ pathname: opts.prefix, url: 'https://blob.test/theses.json' }] }
      : { blobs: [] }
    stub.putCalls.length = 0
    globalThis.fetch = async () => ({
      ok: true, status: 200, headers: { get: () => "test-etag" },
      json: async () => stub.putCalls.length ? JSON.parse(stub.putCalls.at(-1).body) : [],
    })
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'POST', body: { symbol: 'AAPLc', title: 'New', note: 'n' } }), res)
    assert.equal(res.statusCode, 200)
    assert.equal(stub.putCalls.length, 1)
    const written = JSON.parse(stub.putCalls[0].body)
    assert.equal(written.length, 1)
    assert.equal(written[0].symbol, 'AAPLc')
    assert.ok(res.body.editToken, 'editToken returned once at creation')
  })

  it('POST fails closed (503 thesis_store_unavailable, put NOT called) when list() throws', async () => {
    stub.list = async () => { throw new Error('Blob list unavailable') }
    stub.putCalls.length = 0
    globalThis.fetch = blobFetch()
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'POST', body: { symbol: 'AAPLc', title: 'New', note: 'n' } }), res)
    assert.equal(res.statusCode, 503)
    assert.equal(res.body.code, 'thesis_store_unavailable')
    assert.equal(stub.putCalls.length, 0, 'put() must not be called after a failed read')
  })

  it('POST fails closed (503, put NOT called) when the blob fetch rejects', async () => {
    stub.list = listFindsFile()
    stub.putCalls.length = 0
    globalThis.fetch = blobFetch({ throws: new Error('ECONNRESET') })
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'POST', body: { symbol: 'AAPLc', title: 'New', note: 'n' } }), res)
    assert.equal(res.statusCode, 503)
    assert.equal(res.body.code, 'thesis_store_unavailable')
    assert.equal(stub.putCalls.length, 0)
  })

  it('POST fails closed (503, put NOT called) when the blob fetch returns 500', async () => {
    stub.list = listFindsFile()
    stub.putCalls.length = 0
    globalThis.fetch = blobFetch({ ok: false, status: 500 })
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'POST', body: { symbol: 'AAPLc', title: 'New', note: 'n' } }), res)
    assert.equal(res.statusCode, 503)
    assert.equal(res.body.code, 'thesis_store_unavailable')
    assert.equal(stub.putCalls.length, 0)
  })

  it('POST fails closed (500 thesis_store_corrupt, put NOT called) when JSON is broken', async () => {
    stub.list = listFindsFile()
    stub.putCalls.length = 0
    globalThis.fetch = blobFetch({ jsonThrows: true })
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'POST', body: { symbol: 'AAPLc', title: 'New', note: 'n' } }), res)
    assert.equal(res.statusCode, 500)
    assert.equal(res.body.code, 'thesis_store_corrupt')
    assert.equal(stub.putCalls.length, 0)
  })

  it('POST fails closed (500 thesis_store_corrupt, put NOT called) when stored JSON is not an array', async () => {
    stub.list = listFindsFile()
    stub.putCalls.length = 0
    globalThis.fetch = blobFetch({ jsonValue: { not: 'an array' } })
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'POST', body: { symbol: 'AAPLc', title: 'New', note: 'n' } }), res)
    assert.equal(res.statusCode, 500)
    assert.equal(res.body.code, 'thesis_store_corrupt')
    assert.equal(stub.putCalls.length, 0)
  })

  it('PUT fails closed (503, put NOT called) when the blob fetch fails — old thesis is not wiped', async () => {
    stub.list = listFindsFile()
    stub.putCalls.length = 0
    globalThis.fetch = blobFetch({ throws: new Error('ECONNRESET') })
    const res = fakeResponse()
    await handler(
      fakeRequest({ method: 'PUT', headers: { 'x-edit-token': 'tok-1' }, body: { id: 'th_old', symbol: 'AAPLc', title: 'Updated', note: 'n' } }),
      res,
    )
    assert.equal(res.statusCode, 503)
    assert.equal(res.body.code, 'thesis_store_unavailable')
    assert.equal(stub.putCalls.length, 0)
  })

  it('PUT succeeds on a healthy store and preserves the existing thesis', async () => {
    stub.list = listFindsFile()
    stub.putCalls.length = 0
    // Rev 6: the verify re-read must see what the put just wrote.
    globalThis.fetch = async () => ({
      ok: true, status: 200, headers: { get: () => "test-etag" },
      json: async () => stub.putCalls.length ? JSON.parse(stub.putCalls.at(-1).body) : structuredClone(EXISTING),
    })
    const res = fakeResponse()
    await handler(
      fakeRequest({ method: 'PUT', headers: { 'x-edit-token': 'tok-1' }, body: { id: 'th_old', symbol: 'AAPLc', title: 'Updated', note: 'n' } }),
      res,
    )
    assert.equal(res.statusCode, 200)
    assert.equal(stub.putCalls.length, 1)
    const written = JSON.parse(stub.putCalls[0].body)
    assert.equal(written.length, 1)
    assert.equal(written[0].id, 'th_old')
    assert.equal(written[0].title, 'Updated')
    assert.equal(written[0].editToken, 'tok-1', 'edit token is preserved, never rotated or dropped')
  })

  it('GET returns the store error (503), not an empty result, when the blob fetch fails', async () => {
    stub.list = listFindsFile()
    stub.putCalls.length = 0
    globalThis.fetch = blobFetch({ throws: new Error('ECONNRESET') })
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'GET', query: { id: 'th_old' } }), res)
    assert.equal(res.statusCode, 503)
    assert.equal(res.body.code, 'thesis_store_unavailable')
    assert.ok(!res.body.thesis, 'no thesis (and no empty stand-in) on a failed read')
  })

  it('GET with a genuinely missing file returns 404 (not a store error)', async () => {
    stub.list = async () => ({ blobs: [] })
    stub.putCalls.length = 0
    globalThis.fetch = blobFetch()
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'GET', query: { id: 'th_old' } }), res)
    assert.equal(res.statusCode, 404)
  })
})
