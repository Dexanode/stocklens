// Handler integration tests for api/thesis.js (rev 6).
//
// Proves the rev 6 guarantee end-to-end through the real handler: a PUT
// or POST returns 200 ONLY when a fresh re-read shows the change
// persisted. A stale verify read retries the whole cycle; if no attempt
// confirms, the handler answers 503 (thesis_store_not_confirmed) — never
// a false 200 like the one observed live 26 Nov 2026 (PUT 200 at
// 14:48:08, GETs at ~14:49–14:50 still showed the old status).
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
// test can answer with the latest put body.
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

function putStatus(token = 'tok-1') {
  return fakeRequest({
    method: 'PUT',
    headers: { 'x-edit-token': token },
    body: { id: 'th_old', symbol: 'AAPLc', title: 'Old thesis', note: 'keep me', status: 'MONITORING' },
  })
}

describe('thesis handler: a write is 200 only when a fresh re-read confirms it (rev 6)', () => {
  it('PUT with a stale verify read retries and confirms (no false 200, no lost update)', async () => {
    stub.list = listFindsFile()
    stub.putCalls.length = 0
    // Call 1 (initial read): old list. Call 2 (verify): still the old
    // list — the stale read observed live. Call 3 (retry read) and 4
    // (verify): the latest put body, i.e. the write is now visible.
    globalThis.fetch = scriptedFetch([EXISTING, EXISTING, latestPutBody(stub), latestPutBody(stub)])
    const res = fakeResponse()
    await handler(putStatus(), res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.thesis.status, 'MONITORING', 'response carries the record as the re-read confirmed it')
    assert.equal(res.body.thesis.editToken, undefined, 'token never leaks in a PUT response')
    assert.equal(stub.putCalls.length, 2, 'first attempt unconfirmed, second attempt re-ran the cycle')
    const finalBody = JSON.parse(stub.putCalls.at(-1).body)
    assert.equal(finalBody.find((row) => row.id === 'th_old').status, 'MONITORING')
  })

  it('PUT that never confirms returns 503 thesis_store_not_confirmed, never 200', async () => {
    stub.list = listFindsFile()
    stub.putCalls.length = 0
    // Every read returns the old list: the write never becomes visible.
    globalThis.fetch = scriptedFetch([EXISTING])
    const res = fakeResponse()
    await handler(putStatus(), res)
    assert.equal(res.statusCode, 503)
    assert.equal(res.body.code, 'thesis_store_not_confirmed')
    assert.ok(!res.body.thesis, 'no thesis on an unconfirmed write')
    assert.equal(stub.putCalls.length, 3, 'all three attempts must be tried before giving up')
  })

  it('PUT on a healthy store returns 200 with one put and the confirmed record', async () => {
    stub.list = listFindsFile()
    stub.putCalls.length = 0
    globalThis.fetch = scriptedFetch([EXISTING, latestPutBody(stub)])
    const res = fakeResponse()
    await handler(putStatus(), res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.thesis.status, 'MONITORING')
    assert.equal(stub.putCalls.length, 1)
    assert.equal(stub.putCalls[0].opts.cacheControlMaxAge, 0, 'writes must not be edge-cached afterwards')
  })

  it('POST with a stale verify read does not mint a second record on retry', async () => {
    stub.list = listFindsFile()
    stub.putCalls.length = 0
    // Call 1: empty store. Call 2 (verify): still empty — stale.
    // Call 3 (retry read): the record is now visible, so the idempotent
    // mutate short-circuits and no second put happens.
    globalThis.fetch = scriptedFetch([[], [], latestPutBody(stub)])
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'POST', body: { symbol: 'AAPLc', title: 'New', note: 'n' } }), res)
    assert.equal(res.statusCode, 200)
    assert.equal(stub.putCalls.length, 1, 'a retry after a landed put must not create a duplicate')
    assert.ok(res.body.thesis.id.startsWith('th_'))
  })

  it('POST that never confirms returns 503 thesis_store_not_confirmed', async () => {
    stub.list = listFindsFile()
    stub.putCalls.length = 0
    globalThis.fetch = scriptedFetch([[]])
    const res = fakeResponse()
    await handler(fakeRequest({ method: 'POST', body: { symbol: 'AAPLc', title: 'New', note: 'n' } }), res)
    assert.equal(res.statusCode, 503)
    assert.equal(res.body.code, 'thesis_store_not_confirmed')
    assert.equal(stub.putCalls.length, 3)
  })
})

describe('thesis handler: the server assigns the id; the share link must use it (Finding 1)', () => {
  it('POST ignores the client id, GET ?thesisId=<server id> resolves, GET ?thesisId=<client id> 404s', async () => {
    stub.list = listFindsFile()
    stub.putCalls.length = 0
    globalThis.fetch = scriptedFetch([[], latestPutBody(stub)])
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
