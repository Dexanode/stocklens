// Unit tests for src/thesis-share.js (rev 6) — the pure share-link
// resolver. No React, no DOM: the fetch implementation is injected, so
// every branch is driven directly.
//
// Contract under test: a share link must only carry a server id that a
// GET confirms exists. A verified id is used as-is; a 404 re-creates
// the thesis and uses the fresh server id; any other failure falls back
// to "" (the caller then uses the ?thesis= JSON link) and never mints a
// duplicate. The edit token never appears in the returned server id.
//
// Run: node --test tests/thesis-share.test.mjs
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveShareId } from '../src/thesis-share.js'

function okJson(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => value }
}

function makeFetch(script) {
  const calls = []
  const fetchFn = async (url, options) => {
    calls.push({ url, options })
    const next = script.shift()
    if (typeof next === 'function') return next(url, options)
    if (next instanceof Error) throw next
    return next
  }
  return { fetchFn, calls }
}

const LOCAL_ITEM = { id: 'AAPLc-1795676765160', symbol: 'AAPLc', title: 'Local thesis', note: 'n' }
const SERVER_ITEM = { id: 'th_4e47756f-26b9-4d7b-a362-b95040d21bce', symbol: 'AAPLc', title: 'Server thesis', note: 'n' }

describe('resolveShareId', () => {
  it('server id confirmed by GET is used as-is, no POST', async () => {
    const { fetchFn, calls } = makeFetch([okJson({ persistent: true, thesis: { ...SERVER_ITEM, editable: true } })])
    const result = await resolveShareId(SERVER_ITEM, fetchFn)
    assert.deepEqual(result, { serverId: SERVER_ITEM.id, thesis: null, editToken: null })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, `/api/thesis?id=${SERVER_ITEM.id}`)
    assert.equal(calls[0].options, undefined, 'the verify is a plain GET')
  })

  it('server id that 404s is re-created; the fresh server id (not the orphan) is returned', async () => {
    const fresh = { id: 'th_d40d444e-e05f-4586-91e3-df979fa7e732', symbol: 'AAPLc', title: 'Server thesis', note: 'n' }
    const { fetchFn, calls } = makeFetch([
      okJson({ persistent: true, error: 'Thesis not found.' }, 404),
      okJson({ persistent: true, thesis: fresh, editToken: 'tok-fresh' }),
    ])
    const result = await resolveShareId(SERVER_ITEM, fetchFn)
    assert.equal(result.serverId, fresh.id)
    assert.deepEqual(result.thesis, fresh)
    assert.equal(result.editToken, 'tok-fresh')
    assert.equal(calls.length, 2)
    assert.equal(calls[1].options.method, 'POST')
    assert.ok(!result.serverId.includes('tok'), 'the token must never be part of the share id')
  })

  it('local-only thesis is POSTed and the server id from the response is returned', async () => {
    const fresh = { id: 'th_aaaa0000-0000-0000-0000-000000000000', symbol: 'AAPLc', title: 'Local thesis', note: 'n' }
    const { fetchFn, calls } = makeFetch([okJson({ persistent: true, thesis: fresh, editToken: 'tok-new' })])
    const result = await resolveShareId(LOCAL_ITEM, fetchFn)
    assert.equal(result.serverId, fresh.id)
    assert.deepEqual(result.thesis, fresh)
    assert.equal(result.editToken, 'tok-new')
    assert.equal(calls.length, 1, 'no GET verify for a client id — it cannot exist server-side')
    assert.equal(calls[0].url, '/api/thesis')
    assert.deepEqual(JSON.parse(calls[0].options.body), LOCAL_ITEM, 'the item is posted as-is; the server assigns the id')
  })

  it('GET 503 does NOT mint a duplicate: returns "" so the caller falls back to the JSON link', async () => {
    const { fetchFn, calls } = makeFetch([okJson({ persistent: false, error: 'store down' }, 503)])
    const result = await resolveShareId(SERVER_ITEM, fetchFn)
    assert.deepEqual(result, { serverId: '', thesis: null, editToken: null })
    assert.equal(calls.length, 1, 'no POST on a non-404 verify failure')
  })

  it('GET throwing (server unreachable) returns "" without posting', async () => {
    const { fetchFn, calls } = makeFetch([new Error('ECONNREFUSED')])
    const result = await resolveShareId(SERVER_ITEM, fetchFn)
    assert.deepEqual(result, { serverId: '', thesis: null, editToken: null })
    assert.equal(calls.length, 1)
  })

  it('POST failing returns ""', async () => {
    const { fetchFn, calls } = makeFetch([okJson({ error: 'nope' }, 503)])
    const result = await resolveShareId(LOCAL_ITEM, fetchFn)
    assert.deepEqual(result, { serverId: '', thesis: null, editToken: null })
    assert.equal(calls.length, 1)
  })

  it('POST succeeding without a thesis id returns ""', async () => {
    const { fetchFn } = makeFetch([okJson({ persistent: true })])
    const result = await resolveShareId(LOCAL_ITEM, fetchFn)
    assert.deepEqual(result, { serverId: '', thesis: null, editToken: null })
  })

  it('re-create without an editToken in the response still returns the fresh id, token null', async () => {
    const fresh = { id: 'th_bbbb0000-0000-0000-0000-000000000000', symbol: 'AAPLc', title: 'Server thesis', note: 'n' }
    const { fetchFn } = makeFetch([
      okJson({ persistent: true, error: 'Thesis not found.' }, 404),
      okJson({ persistent: true, thesis: fresh }),
    ])
    const result = await resolveShareId(SERVER_ITEM, fetchFn)
    assert.equal(result.serverId, fresh.id)
    assert.equal(result.editToken, null)
  })
})
