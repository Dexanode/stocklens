// Handler integration tests for api/thesis.js (rev 7).
//
// Rev 7 contract change — read this before touching these tests: a
// successful put() IS the write. Rev 6 gated success on a verify
// re-read and answered 503 when the re-read could not see a landed
// write; live on the 26 Nov 2026 preview, Blob reads lag writes by
// ~10–25 s, so that gate produced false 503s (POST returned 503 for
// th_a3aa861e…, which WAS stored — the UI never got the edit token and
// the thesis became uneditable; 0 PUTs in the function logs). Rev 7
// answers 200 with the record as written plus the edit token whenever
// put() succeeds, and reports `verified` / `pendingPropagation` for
// whether a fresh re-read on a bounded schedule has already seen the
// change. `verified: false` is a normal outcome under propagation lag,
// never an error. A 503 now happens ONLY when put() itself throws on
// every attempt (thesis_store_write_failed) or the pre-write read
// fails outright (rev 4 fail-closed).
//
// The old rev-6 tests "PUT/POST that never confirms returns 503" are
// therefore REPLACED here by their rev-7 opposites: a write whose
// verify reads never see it must return 200 with verified:false —
// never a 503. That replacement is the point of this revision, not a
// weakening: the write demonstrably landed (the put body holds it).
//
// Also proves the Finding-1 server contract: the server assigns the id
// (a client-supplied id is ignored), and GET ?thesisId=<server id>
// resolves while GET ?thesisId=<client id> 404s.
//
// Run: node --test tests/thesis-write-confirm.test.mjs
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { loadHandler, fakeRequest, fakeResponse } from './handler-sandbox.mjs'

process.env.BLOB_READ_WRITE_TOKEN = 'test-token'

const EXISTING = [
  { id: 'th_old', symbol: 'AAPLc', title: 'Old thesis', note: 'keep me', conviction: 4, status: 'OPEN', editToken: 'tok-1' },
]

// list() that finds the stored file; the handler fetches its content via
// global fetch, which each test scripts per call.
function listFindsFile() {
  return async (opts) => ({ blobs: [{ pathname: opts.prefix, url: 'https://blob.test/theses.json' }] })
}

// fetch that consumes `script` in order (one entry per fetch call; the
// last entry repeats). An entry may be a function receiving stub, so a
// test can answer with the latest put body. NOTE (rev 7): the handler
// now makes up to 3 initial reads before the put, so scripts need at
// least 3 entries before any latestPutBody entry — before the first put
// there is no put body to read.
function scriptedFetch(script) {
  let i = 0
  return async () => {
    const entry = script[Math.min(i, script.length - 1)]
    i++
    const value = typeof entry === 'function' ? entry() : entry
    return { ok: true, status: 200, json: async () => structuredClone(value) }
  }
}

const latestPutBody = (stub) => () => JSON.parse(stub.putCalls.at(-1).body)

let handler
let stub
let cleanup

before(async () => {
  ;({ handler, stub, cleanup } = await loadHandler('thesis.js'))
})

after(async () => {
  await cleanup()
})

function resetStub() {
  stub.putCalls.length = 0
  stub.failPutTimes = 0
  stub.failPutAfterApplyTimes = 0
}

function putStatus(token = 'tok-1') {
  return fakeRequest({
    method: 'PUT',
    headers: { 'x-edit-token': token },
    body: { id: 'th_old', symbol: 'AAPLc', title: 'Old thesis', note: 'keep me', status: 'MONITORING' },
  })
}

describe('thesis handler: put() succeeding IS the write (rev 7)', () => {
  it('PUT with a stale verify read confirms within the budget (200, verified true, one put)', async () => {
    stub.list = listFindsFile()
    resetStub()
    // Calls 1–3 (initial reads): old list. Call 4 (verify #1): still
    // the old list — the stale read observed live. Call 5 (verify #2):
    // the latest put body, i.e. the write is now visible.
    globalThis.fetch = scriptedFetch([EXISTING, EXISTING, EXISTING, EXISTING, latestPutBody(stub)])
    const res = fakeResponse()
    await handler(putStatus(), res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.thesis.status, 'MONITORING', 'response carries the record as written')
    assert.equal(res.body.verified, true)
    assert.equal(res.body.pendingPropagation, false)
    assert.equal(res.body.thesis.editToken, undefined, 'token never leaks in a PUT response')
    assert.equal(stub.putCalls.length, 1, 'no whole-cycle retry: the soft verify retried, not the write')
    const finalBody = JSON.parse(stub.putCalls.at(-1).body)
    assert.equal(finalBody.find((row) => row.id === 'th_old').status, 'MONITORING')
  })

  it('PUT whose verify reads NEVER see the write still returns 200 with verified:false — never 503 (the rev 6 regression)', async () => {
    stub.list = listFindsFile()
    resetStub()
    // Every read returns the old list: the write never becomes visible
    // inside the verify window — exactly the live rev-6 case.
    globalThis.fetch = scriptedFetch([EXISTING])
    const res = fakeResponse()
    await handler(putStatus(), res)
    assert.equal(res.statusCode, 200, 'put() succeeded, so the write succeeded')
    assert.equal(res.body.thesis.status, 'MONITORING', 'the response carries the record as written')
    assert.equal(res.body.verified, false)
    assert.equal(res.body.pendingPropagation, true, 'the UI is told to re-fetch later, not that the write failed')
    assert.equal(stub.putCalls.length, 1, 'the write landed once')
    const finalBody = JSON.parse(stub.putCalls.at(-1).body)
    assert.equal(finalBody.find((row) => row.id === 'th_old').status, 'MONITORING', 'the put body really holds the change')
  })

  it('PUT on a healthy store returns 200 with one put and the written record', async () => {
    stub.list = listFindsFile()
    resetStub()
    globalThis.fetch = scriptedFetch([EXISTING, EXISTING, EXISTING, latestPutBody(stub)])
    const res = fakeResponse()
    await handler(putStatus(), res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.thesis.status, 'MONITORING')
    assert.equal(res.body.verified, true)
    assert.equal(stub.putCalls.length, 1)
    assert.equal(stub.putCalls[0].opts.cacheControlMaxAge, 0, 'writes must not be edge-cached afterwards')
  })

  it('POST with lagging verify reads returns 200 + token, one put, no duplicate', async () => {
    stub.list = listFindsFile()
    resetStub()
    // Calls 1–3: empty store. Call 4 (verify #1): still empty — stale.
    // Call 5 (verify #2): the record is now visible.
    globalThis.fetch = scriptedFetch([[], [], [], [], latestPutBody(stub)])
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'POST', body: { symbol: 'AAPLc', title: 'New', note: 'n' } }), res)
    assert.equal(res.statusCode, 200)
    assert.equal(stub.putCalls.length, 1, 'one put: the soft verify retried, the write did not')
    assert.ok(res.body.thesis.id.startsWith('th_'))
    assert.ok(res.body.editToken, 'the token IS returned on a 200 create — the rev-6 503 withheld it')
    assert.equal(res.body.verified, true)
  })

  it('POST whose verify reads NEVER see the write still returns 200 + token with verified:false — never 503', async () => {
    stub.list = listFindsFile()
    resetStub()
    globalThis.fetch = scriptedFetch([[]])
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'POST', body: { symbol: 'AAPLc', title: 'New', note: 'n' } }), res)
    assert.equal(res.statusCode, 200)
    assert.equal(stub.putCalls.length, 1, 'the write landed once')
    assert.ok(res.body.thesis.id.startsWith('th_'))
    assert.ok(res.body.editToken, 'the creator gets the token even though the write is not yet visible to reads')
    assert.equal(res.body.verified, false)
    assert.equal(res.body.pendingPropagation, true)
    const written = JSON.parse(stub.putCalls[0].body)
    assert.equal(written.length, 1, 'exactly one record was written')
  })

  it('put() throwing on every attempt returns 503 thesis_store_write_failed, never 200', async () => {
    stub.list = listFindsFile()
    resetStub()
    stub.failPutTimes = 99
    globalThis.fetch = scriptedFetch([EXISTING])
    const res = fakeResponse()
    await handler(putStatus(), res)
    assert.equal(res.statusCode, 503)
    assert.equal(res.body.code, 'thesis_store_write_failed')
    assert.ok(!res.body.thesis, 'no thesis when the write itself failed')
    assert.equal(stub.putCalls.length, 0, 'no successful put was recorded')
  })

  it('initial read failing once then succeeding -> the write proceeds (200)', async () => {
    let listCalls = 0
    stub.list = async (opts) => {
      listCalls++
      if (listCalls === 1) throw new Error('Blob list unavailable')
      return { blobs: [{ pathname: opts.prefix, url: 'https://blob.test/theses.json' }] }
    }
    resetStub()
    globalThis.fetch = scriptedFetch([EXISTING, EXISTING, EXISTING, latestPutBody(stub)])
    const res = fakeResponse()
    await handler(putStatus(), res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.thesis.status, 'MONITORING')
    assert.equal(stub.putCalls.length, 1)
  })
})

describe('thesis handler: the server assigns the id; the share link must use it (Finding 1)', () => {
  it('POST ignores the client id, GET ?thesisId=<server id> resolves, GET ?thesisId=<client id> 404s', async () => {
    stub.list = listFindsFile()
    resetStub()
    globalThis.fetch = scriptedFetch([[], [], [], latestPutBody(stub)])
    const postRes = fakeResponse()
    await handler(fakeRequest({ method: 'POST', body: { id: 'AAPLc-12345', symbol: 'AAPLc', title: 'Client id', note: 'n' } }), postRes)
    assert.equal(postRes.statusCode, 200)
    const serverId = postRes.body.thesis.id
    assert.ok(serverId.startsWith('th_'), 'server assigns a th_ id')
    assert.notEqual(serverId, 'AAPLc-12345', 'the client-supplied id must not survive')
    assert.ok(postRes.body.editToken, 'editToken returned once at creation')

    // The stored list is now the put body; GET resolves the server id…
    globalThis.fetch = scriptedFetch([JSON.parse(stub.putCalls[0].body)])
    const getRes = fakeResponse()
    await handler(fakeRequest({ method: 'GET', url: `/api/thesis?id=${serverId}` }), getRes)
    assert.equal(getRes.statusCode, 200)
    assert.equal(getRes.body.thesis.id, serverId)
    assert.equal(getRes.body.thesis.editToken, undefined, 'GET never leaks the token')

    // …and the client id is not a thesis at all.
    const missRes = fakeResponse()
    await handler(fakeRequest({ method: 'GET', url: '/api/thesis?id=AAPLc-12345' }), missRes)
    assert.equal(missRes.statusCode, 404)
  })
})
