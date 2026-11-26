// Handler integration tests for the rev 5 GET fix in api/thesis.js.
//
// Regression: on the 26 Nov 2026 preview deploy, GET /api/thesis?id=<id>
// returned 404 six times for a thesis that PUT with the same id updated
// fine (200) — the GET branch read the id ONLY from `request.query?.id`,
// which the live runtime never populated. Rev 5 parses the id from the raw
// request URL (accepting `id` and `thesisId`), keeps `request.query` as a
// fallback, serves single-thesis GET with `no-store`, and restores the
// list view for a GET with no id.
//
// This file also closes the live-verification gap from the 26 Nov browser
// retest: the browser had no DevTools console, so PUT without a token /
// with a wrong token (expect 401) could not be exercised live. The PUT
// ownership matrix is proven here at handler level against a stubbed Blob.
//
// Run: node --test tests/thesis-get.test.mjs  (or: node --test tests/*.test.mjs)
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { loadHandler, fakeRequest, fakeResponse } from './handler-sandbox.mjs'

process.env.BLOB_READ_WRITE_TOKEN = 'test-token'

const OWNED = { id: 'th_owned', symbol: 'AAPLc', title: 'Owned thesis', note: 'keep me', conviction: 4, status: 'OPEN', editToken: 'tok-1' }
const LEGACY = { id: 'th_legacy', symbol: 'NVDAc', title: 'Legacy thesis', note: 'old', conviction: 3, status: 'OPEN' }
const EXISTING = [OWNED, LEGACY]

function listFindsFile() {
  return async (opts) => ({ blobs: [{ pathname: opts.prefix, url: 'https://blob.test/theses.json' }] })
}

function seedStore() {
  stub.list = listFindsFile()
  stub.putCalls.length = 0
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => EXISTING })
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

describe('thesis GET: id is read from the request URL (rev 5 regression)', () => {
  it('GET ?id=<owned id> via url only (empty request.query) returns 200 with the thesis, no token', async () => {
    seedStore()
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'GET', url: '/api/thesis?id=th_owned', query: {} }), res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.thesis.id, 'th_owned')
    assert.equal(res.body.thesis.symbol, 'AAPLc')
    assert.equal(res.body.thesis.editToken, undefined, 'GET must never leak the edit token')
    assert.equal(res.body.thesis.editable, true)
    assert.equal(res.headers['Cache-Control'], 'no-store', 'single-thesis GET must not be publicly cacheable')
  })

  it('GET ?thesisId=<owned id> via url returns 200 (alias used by share links)', async () => {
    seedStore()
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'GET', url: '/api/thesis?thesisId=th_owned', query: {} }), res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.thesis.id, 'th_owned')
  })

  it('GET ?id=<legacy id> returns 200, editable false, no token', async () => {
    seedStore()
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'GET', url: '/api/thesis?id=th_legacy', query: {} }), res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.thesis.id, 'th_legacy')
    assert.equal(res.body.thesis.editable, false, 'legacy thesis has no owner token')
    assert.equal(res.body.thesis.editToken, undefined)
  })

  it('GET ?id=<unknown> returns 404', async () => {
    seedStore()
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'GET', url: '/api/thesis?id=th_nope', query: {} }), res)
    assert.equal(res.statusCode, 404)
    assert.equal(res.body.error, 'Thesis not found.')
  })

  it('GET with no id returns the list (all theses, public form, no tokens)', async () => {
    seedStore()
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'GET', url: '/api/thesis', query: {} }), res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.theses.length, 2)
    assert.ok(res.body.theses.every((t) => t.editToken === undefined), 'list must never leak edit tokens')
    assert.deepEqual(res.body.theses.map((t) => t.editable), [true, false])
  })

  it('GET falls back to request.query when url carries no query string', async () => {
    seedStore()
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'GET', url: '/api/thesis', query: { id: 'th_owned' } }), res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.thesis.id, 'th_owned')
  })

  it('GET ?id= with an empty value returns the list, not a 404', async () => {
    seedStore()
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'GET', url: '/api/thesis?id=', query: {} }), res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.theses.length, 2)
  })
})

describe('thesis PUT: ownership matrix at handler level (rev 5)', () => {
  it('PUT without a token returns 401 edit_token_required and does not write', async () => {
    seedStore()
    const res = fakeResponse()
    await handler(
      fakeRequest({ method: 'PUT', headers: {}, body: { id: 'th_owned', symbol: 'AAPLc', title: 'Hijack', note: 'n' } }),
      res,
    )
    assert.equal(res.statusCode, 401)
    assert.equal(res.body.code, 'edit_token_required')
    assert.equal(stub.putCalls.length, 0, 'unauthorized PUT must not write')
  })

  it('PUT with a wrong token returns 401 edit_token_mismatch and does not write', async () => {
    seedStore()
    const res = fakeResponse()
    await handler(
      fakeRequest({ method: 'PUT', headers: { 'x-edit-token': 'wrong-token' }, body: { id: 'th_owned', symbol: 'AAPLc', title: 'Hijack', note: 'n' } }),
      res,
    )
    assert.equal(res.statusCode, 401)
    assert.equal(res.body.code, 'edit_token_mismatch')
    assert.equal(stub.putCalls.length, 0)
  })

  it('PUT with the correct token returns 200, writes, and preserves the token', async () => {
    seedStore()
    const res = fakeResponse()
    await handler(
      fakeRequest({ method: 'PUT', headers: { 'x-edit-token': 'tok-1' }, body: { id: 'th_owned', symbol: 'AAPLc', title: 'Edited by owner', note: 'n' } }),
      res,
    )
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.thesis.title, 'Edited by owner')
    assert.equal(res.body.thesis.editToken, undefined, 'PUT response must never return the token')
    assert.equal(stub.putCalls.length, 1)
    const written = JSON.parse(stub.putCalls[0].body)
    assert.equal(written.find((t) => t.id === 'th_owned').editToken, 'tok-1', 'token preserved in the stored record')
  })

  it('PUT to a legacy thesis returns 410 thesis_legacy_read_only and does not write', async () => {
    seedStore()
    const res = fakeResponse()
    await handler(
      fakeRequest({ method: 'PUT', headers: {}, body: { id: 'th_legacy', symbol: 'NVDAc', title: 'Hijack', note: 'n' } }),
      res,
    )
    assert.equal(res.statusCode, 410)
    assert.equal(res.body.code, 'thesis_legacy_read_only')
    assert.equal(stub.putCalls.length, 0)
  })

  it('PUT to an unknown id returns 404 and does not create', async () => {
    seedStore()
    const res = fakeResponse()
    await handler(
      fakeRequest({ method: 'PUT', headers: { 'x-edit-token': 'tok-1' }, body: { id: 'th_nope', symbol: 'AAPLc', title: 'Plant', note: 'n' } }),
      res,
    )
    assert.equal(res.statusCode, 404)
    assert.equal(stub.putCalls.length, 0)
  })
})
