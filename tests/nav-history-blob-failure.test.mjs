// Handler integration tests for api/nav-history.js (rev 4).
//
// Same fail-closed rule as the thesis handler: a failed Blob read must
// return an error and never reach put(), so stored NAV history can never
// be wiped by a transient Blob failure. Also proves a POST with a fake
// client price stores only the server-observed live NAV from Coinbase,
// never the client-supplied price.
//
// Run: node --test tests/nav-history-blob-failure.test.mjs  (or: node --test tests/)
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { loadHandler, fakeRequest, fakeResponse } from './handler-sandbox.mjs'

process.env.BLOB_READ_WRITE_TOKEN = 'test-token'

const LIVE_NAV = { tokens: [
  { symbol: 'AAPLc', nav_price: 355.08 },
  { symbol: 'MSFTc', nav_price: 410.5 },
], next_page_token: '' }

// Router for global fetch: Coinbase -> canned live NAV; blob.test -> the
// per-test blob behaviour set via `blobBehaviour`.
let blobBehaviour = { ok: true, status: 200, jsonValue: {}, jsonThrows: false, throws: null }

function installFetchRouter() {
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://api.coinbase.com')) {
      return { ok: true, status: 200, json: async () => LIVE_NAV }
    }
    // Rev 6: the verify re-read must see what the put just wrote.
    if (stub.putCalls.length) {
      return { ok: true, status: 200, json: async () => JSON.parse(stub.putCalls.at(-1).body) }
    }
    if (blobBehaviour.throws) throw blobBehaviour.throws
    return {
      ok: blobBehaviour.ok,
      status: blobBehaviour.status,
      json: async () => {
        if (blobBehaviour.jsonThrows) throw new SyntaxError('Unexpected token in JSON')
        return blobBehaviour.jsonValue
      },
    }
  }
}

function listFindsFile() {
  return async (opts) => ({ blobs: [{ pathname: opts.prefix, url: 'https://blob.test/nav-history.json' }] })
}

let handler
let stub
let cleanup

before(async () => {
  ;({ handler, stub, cleanup } = await loadHandler('nav-history.js'))
  installFetchRouter()
})

after(async () => {
  await cleanup()
})

describe('nav-history handler: failed Blob read must never cause a write', () => {
  it('GET with a genuinely missing file returns an empty history', async () => {
    stub.list = async () => ({ blobs: [] })
    blobBehaviour = { ok: true, status: 200, jsonValue: {}, jsonThrows: false, throws: null }
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'GET' }), res)
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body.history, {})
  })

  it('GET fails closed (503 nav_history_store_unavailable) when the blob fetch returns 500', async () => {
    stub.list = listFindsFile()
    blobBehaviour = { ok: false, status: 500, jsonValue: {}, jsonThrows: false, throws: null }
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'GET' }), res)
    assert.equal(res.statusCode, 503)
    assert.equal(res.body.code, 'nav_history_store_unavailable')
    assert.deepEqual(res.body.history, {})
  })

  it('GET fails closed (500 nav_history_store_corrupt) when stored JSON is broken', async () => {
    stub.list = listFindsFile()
    blobBehaviour = { ok: true, status: 200, jsonValue: {}, jsonThrows: true, throws: null }
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'GET' }), res)
    assert.equal(res.statusCode, 500)
    assert.equal(res.body.code, 'nav_history_store_corrupt')
  })

  it('POST stores only the server-observed live NAV, never the fake client price', async () => {
    // Rev 6: list() reports the file once a put has happened, so the
    // verify re-read sees it (the initial read still sees a missing file).
    stub.list = async (opts) => stub.putCalls.length
      ? { blobs: [{ pathname: opts.prefix, url: 'https://blob.test/nav-history.json' }] }
      : { blobs: [] }
    stub.putCalls.length = 0
    blobBehaviour = { ok: true, status: 200, jsonValue: {}, jsonThrows: false, throws: null }
    const res = fakeResponse()
    await handler(
      fakeRequest({ method: 'POST', body: { symbols: ['AAPLc'], snapshots: [{ symbol: 'AAPLc', price: 999999 }] } }),
      res,
    )
    assert.equal(res.statusCode, 200)
    assert.equal(stub.putCalls.length, 1)
    const written = JSON.parse(stub.putCalls[0].body)
    assert.equal(written.AAPLc.length, 1)
    assert.equal(written.AAPLc[0].price, 355.08, 'stored price is the live NAV, not the client-supplied 999999')
    assert.ok(!JSON.stringify(written).includes('999999'))
  })

  it('POST preserves existing points (appends, does not wipe) on a healthy read', async () => {
    const oldPoint = { timestamp: Date.now() - 3600e3, price: 350 }
    stub.list = listFindsFile()
    stub.putCalls.length = 0
    blobBehaviour = { ok: true, status: 200, jsonValue: { AAPLc: [oldPoint] }, jsonThrows: false, throws: null }
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'POST', body: { symbols: ['AAPLc'] } }), res)
    assert.equal(res.statusCode, 200)
    assert.equal(stub.putCalls.length, 1)
    const written = JSON.parse(stub.putCalls[0].body)
    assert.equal(written.AAPLc.length, 2)
    assert.deepEqual(written.AAPLc[0], oldPoint, 'the previously stored point survives')
    assert.equal(written.AAPLc[1].price, 355.08)
  })

  it('POST fails closed (503, put NOT called) when the existing history cannot be fetched', async () => {
    stub.list = listFindsFile()
    stub.putCalls.length = 0
    blobBehaviour = { ok: true, status: 200, jsonValue: {}, jsonThrows: false, throws: new Error('ECONNRESET') }
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'POST', body: { symbols: ['AAPLc'] } }), res)
    assert.equal(res.statusCode, 503)
    assert.equal(res.body.code, 'nav_history_store_unavailable')
    assert.equal(stub.putCalls.length, 0, 'put() must not be called after a failed read')
  })

  it('POST fails closed (500 nav_history_store_corrupt, put NOT called) when stored history JSON is broken', async () => {
    stub.list = listFindsFile()
    stub.putCalls.length = 0
    blobBehaviour = { ok: true, status: 200, jsonValue: {}, jsonThrows: true, throws: null }
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'POST', body: { symbols: ['AAPLc'] } }), res)
    assert.equal(res.statusCode, 500)
    assert.equal(res.body.code, 'nav_history_store_corrupt')
    assert.equal(stub.putCalls.length, 0)
  })
})
