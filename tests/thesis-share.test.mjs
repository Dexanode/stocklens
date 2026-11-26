// Unit tests for src/thesis-share.js (rev 7) — the pure share-link
// resolver. No React, no DOM: the fetch implementation is injected, so
// every branch is driven directly.
//
// Rev 7 contract change — read this before touching these tests: rev 6
// treated a single verify-GET 404 as "missing" and re-created the
// thesis. Live on the 26 Nov 2026 preview, Blob reads lag writes by
// ~10–25 s, so that one 404 was usually just a stale read — and the
// re-create stored the same thesis twice (th_e27e0fe5… + th_d6c52364…,
// identical title/note/createdAt). Rev 7 therefore:
//   (a) retries the verify GET on a bounded schedule — only when every
//       attempt 404s is the record treated as gone; a non-404 failure
//       (503/500, network error) concludes nothing and returns "";
//   (b) checks the list for a content match (same id first, then same
//       symbol + title + note + createdAt + entry price) before
//       re-creating — including for local-only theses, whose record may
//       already exist server-side under a server id (e.g. its creation
//       POST returned a rev-6 503 while the record landed).
// A share link must only carry a server id that a GET confirms exists
// or a list match adopts. The edit token never appears in the returned
// server id.
//
// `resolveShareId(item, fetchFn, { verifyDelaysMs })` — tests pass
// [0] (single attempt, instant) unless the case is about retrying.
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

const NO_DELAY = { verifyDelaysMs: [0] }
const LOCAL_ITEM = { id: 'AAPLc-1795676765160', symbol: 'AAPLc', title: 'Local thesis', note: 'n', createdAt: '2026-11-26T08:15:05.521Z', entryPriceValue: 355.08 }
const SERVER_ITEM = { id: 'th_4e47756f-26b9-4d7b-a362-b95040d21bce', symbol: 'AAPLc', title: 'Server thesis', note: 'n', createdAt: '2026-11-26T07:22:28.305Z', entryPriceValue: 355.08 }

describe('resolveShareId (rev 7: retry the verify, dedup before re-creating)', () => {
  it('server id confirmed by GET is used as-is, no POST', async () => {
    const { fetchFn, calls } = makeFetch([okJson({ persistent: true, thesis: { ...SERVER_ITEM, editable: true } })])
    const result = await resolveShareId(SERVER_ITEM, fetchFn, NO_DELAY)
    assert.deepEqual(result, { serverId: SERVER_ITEM.id, thesis: null, editToken: null })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, `/api/thesis?id=${SERVER_ITEM.id}`)
    assert.equal(calls[0].options, undefined, 'the verify is a plain GET')
  })

  it('a single stale 404 followed by a 200 on retry uses the ORIGINAL id — no re-create (the rev 6 duplicate bug)', async () => {
    const { fetchFn, calls } = makeFetch([
      okJson({ persistent: true, error: 'Thesis not found.' }, 404),
      okJson({ persistent: true, thesis: { ...SERVER_ITEM, editable: true } }),
    ])
    const result = await resolveShareId(SERVER_ITEM, fetchFn, { verifyDelaysMs: [0, 1] })
    assert.deepEqual(result, { serverId: SERVER_ITEM.id, thesis: null, editToken: null })
    assert.equal(calls.length, 2, 'one stale 404 + one confirming 200, no POST')
    assert.ok(calls.every((call) => call.url.startsWith('/api/thesis?id=')), 'only verify GETs, no POST')
  })

  it('all-404 verify + list shows a content match -> adopts the existing id, no POST', async () => {
    const stored = { ...SERVER_ITEM, title: 'Server thesis', note: 'n' }
    const orphan = { ...SERVER_ITEM, id: 'th_orphan000-0000-0000-0000-000000000000' }
    const { fetchFn, calls } = makeFetch([
      okJson({ persistent: true, error: 'Thesis not found.' }, 404),
      okJson({ persistent: true, theses: [stored] }),
    ])
    const result = await resolveShareId(orphan, fetchFn, NO_DELAY)
    assert.equal(result.serverId, stored.id)
    assert.deepEqual(result.thesis, stored, 'the caller adopts the matched record, healing the local copy')
    assert.equal(result.editToken, null)
    assert.equal(calls.length, 2)
    assert.equal(calls[1].url, '/api/thesis', 'second call is the list dedup check, not a POST')
  })

  it('all-404 verify + list shows no match -> re-creates; the fresh server id (not the orphan) is returned', async () => {
    const fresh = { id: 'th_d40d444e-e05f-4586-91e3-df979fa7e732', symbol: 'AAPLc', title: 'Server thesis', note: 'n' }
    const { fetchFn, calls } = makeFetch([
      okJson({ persistent: true, error: 'Thesis not found.' }, 404),
      okJson({ persistent: true, theses: [] }),
      okJson({ persistent: true, thesis: fresh, editToken: 'tok-fresh' }),
    ])
    const result = await resolveShareId(SERVER_ITEM, fetchFn, NO_DELAY)
    assert.equal(result.serverId, fresh.id)
    assert.deepEqual(result.thesis, fresh)
    assert.equal(result.editToken, 'tok-fresh')
    assert.equal(calls.length, 3)
    assert.equal(calls[2].options.method, 'POST')
    assert.ok(!result.serverId.includes('tok'), 'the token must never be part of the share id')
  })

  it('local-only thesis whose content already exists server-side is adopted, not re-created', async () => {
    const stored = { id: 'th_e27e0fe5-7d35-4d18-b3ba-b9bd78a4446e', ...LOCAL_ITEM }
    const { fetchFn, calls } = makeFetch([okJson({ persistent: true, theses: [stored] })])
    const result = await resolveShareId(LOCAL_ITEM, fetchFn, NO_DELAY)
    assert.equal(result.serverId, stored.id, 'adopts the server id of the record that already exists')
    assert.deepEqual(result.thesis, stored)
    assert.equal(calls.length, 1, 'list check only, no POST')
  })

  it('local-only thesis with no content match is POSTed and the server id from the response is returned', async () => {
    const fresh = { id: 'th_aaaa0000-0000-0000-0000-000000000000', symbol: 'AAPLc', title: 'Local thesis', note: 'n' }
    const { fetchFn, calls } = makeFetch([
      okJson({ persistent: true, theses: [] }),
      okJson({ persistent: true, thesis: fresh, editToken: 'tok-new' }),
    ])
    const result = await resolveShareId(LOCAL_ITEM, fetchFn, NO_DELAY)
    assert.equal(result.serverId, fresh.id)
    assert.deepEqual(result.thesis, fresh)
    assert.equal(result.editToken, 'tok-new')
    assert.equal(calls.length, 2, 'list dedup check, then the POST')
    assert.equal(calls[0].url, '/api/thesis')
    assert.equal(calls[1].options.method, 'POST')
    assert.deepEqual(JSON.parse(calls[1].options.body), LOCAL_ITEM, 'the item is posted as-is; the server assigns the id')
  })

  it('GET 503 on every verify attempt does NOT mint a duplicate: returns "" so the caller falls back to the JSON link', async () => {
    const { fetchFn, calls } = makeFetch([okJson({ persistent: false, error: 'store down' }, 503)])
    const result = await resolveShareId(SERVER_ITEM, fetchFn, NO_DELAY)
    assert.deepEqual(result, { serverId: '', thesis: null, editToken: null })
    assert.equal(calls.length, 1, 'no list check, no POST on a non-404 verify failure')
  })

  it('GET throwing (server unreachable) returns "" without posting', async () => {
    const { fetchFn, calls } = makeFetch([new Error('ECONNREFUSED')])
    const result = await resolveShareId(SERVER_ITEM, fetchFn, NO_DELAY)
    assert.deepEqual(result, { serverId: '', thesis: null, editToken: null })
    assert.equal(calls.length, 1)
  })

  it('verify 404s but the list check fails -> "" (never re-create blind)', async () => {
    const { fetchFn, calls } = makeFetch([
      okJson({ persistent: true, error: 'Thesis not found.' }, 404),
      okJson({ persistent: false, error: 'store down' }, 503),
    ])
    const result = await resolveShareId(SERVER_ITEM, fetchFn, NO_DELAY)
    assert.deepEqual(result, { serverId: '', thesis: null, editToken: null })
    assert.equal(calls.length, 2, 'verify + list check, still no POST')
  })

  it('POST failing returns ""', async () => {
    const { fetchFn, calls } = makeFetch([
      okJson({ persistent: true, theses: [] }),
      okJson({ error: 'nope' }, 503),
    ])
    const result = await resolveShareId(LOCAL_ITEM, fetchFn, NO_DELAY)
    assert.deepEqual(result, { serverId: '', thesis: null, editToken: null })
    assert.equal(calls.length, 2)
  })

  it('POST succeeding without a thesis id returns ""', async () => {
    const { fetchFn } = makeFetch([
      okJson({ persistent: true, theses: [] }),
      okJson({ persistent: true }),
    ])
    const result = await resolveShareId(LOCAL_ITEM, fetchFn, NO_DELAY)
    assert.deepEqual(result, { serverId: '', thesis: null, editToken: null })
  })

  it('re-create without an editToken in the response still returns the fresh id, token null', async () => {
    const fresh = { id: 'th_bbbb0000-0000-0000-0000-000000000000', symbol: 'AAPLc', title: 'Server thesis', note: 'n' }
    const { fetchFn } = makeFetch([
      okJson({ persistent: true, error: 'Thesis not found.' }, 404),
      okJson({ persistent: true, theses: [] }),
      okJson({ persistent: true, thesis: fresh }),
    ])
    const result = await resolveShareId(SERVER_ITEM, fetchFn, NO_DELAY)
    assert.equal(result.serverId, fresh.id)
    assert.equal(result.editToken, null)
  })
})
