// Unit tests for readModifyWrite in api/lib/blob-store.js (rev 7).
//
// Rev 7 contract change — read this before touching these tests: a
// successful put() IS the write. Rev 6 gated success on a verify
// re-read and answered 503 when the re-read could not see a landed
// write; live on the 26 Nov 2026 preview, Blob reads lag writes by
// ~10–25 s, so that gate produced false 503s (POST returned 503 for
// th_a3aa861e…, which WAS stored — the UI never got the edit token and
// the thesis became uneditable) and the share flow duplicated records
// on stale 404s. Rev 7 returns { value, verified }: `value` is what
// was written, `verified` reports whether a fresh re-read on a bounded
// schedule has already seen it. `verified: false` is a normal outcome
// under propagation lag, never an error. A 503 (BlobWriteError) now
// happens ONLY when put() itself throws on every attempt.
//
// The fake store below separates what put() wrote (`real`) from what
// fetch() returns (`visible`), so a test can simulate the stale reads
// observed live by lagging `visible` behind `real`.
//
// Run: node --test tests/blob-write.test.mjs   (or: node --test tests/)
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readModifyWrite, BlobWriteError, BlobReadError, FailRequest } from '../api/lib/blob-store.js'

const PATH = 'stocklens/theses.json'
const TOKEN = 'test-token'

function makeStore(initial) {
  let real = structuredClone(initial)
  let visible = structuredClone(initial)
  let fetchCalls = 0
  let syncOnFetchCall = 0
  let autoSync = true
  const fetchUrls = []
  const fetchImpl = async (url) => {
    fetchCalls++
    fetchUrls.push(url)
    if (syncOnFetchCall && fetchCalls === syncOnFetchCall) visible = structuredClone(real)
    return { ok: true, status: 200, headers: { get: () => "test-etag" }, json: async () => structuredClone(visible) }
  }
  const list = async () => ({ blobs: [{ pathname: PATH, url: 'https://blob.test/theses.json' }] })
  const putCalls = []
  let failPutTimes = 0
  let failPutAfterApplyTimes = 0
  const put = async (path, body, opts) => {
    // Record the attempt first (as rev 6 did): putCalls counts put
    // attempts, including ones that then throw.
    putCalls.push({ path, body, opts })
    if (failPutTimes > 0) {
      failPutTimes--
      throw new Error('put transport failed')
    }
    real = JSON.parse(body)
    if (failPutAfterApplyTimes > 0) {
      failPutAfterApplyTimes--
      throw new Error('put transport failed after write')
    }
    if (autoSync) visible = structuredClone(real)
    return { url: 'https://blob.test/theses.json' }
  }
  return {
    fetchImpl, list, put, putCalls, fetchUrls,
    get real() { return real },
    get fetchCalls() { return fetchCalls },
    syncVisible() { visible = structuredClone(real) },
    setSyncOnFetchCall(n) { syncOnFetchCall = n },
    // Stale-read tests turn this off so fetch() keeps returning the
    // pre-write snapshot until setSyncOnFetchCall fires.
    setAutoSync(v) { autoSync = v },
    failPutTimes(n) { failPutTimes = n },
    // The put "lands" (real is updated and the call recorded) but
    // reports failure — the ambiguous case a retry must survive
    // without writing twice.
    failPutAfterApplyTimes(n) { failPutAfterApplyTimes = n },
  }
}

// Idempotent append: a retry re-runs this on a fresher read, so it must
// not add the item twice when the first put already landed.
function appendOnce(item) {
  return (current) => (current.includes(item) ? current : [...current, item])
}

const confirmHas = (item) => (written, stored) =>
  stored.includes(item) && written.every((row) => stored.includes(row))

const baseOpts = (store) => ({
  list: store.list,
  put: store.put,
  fetchImpl: store.fetchImpl,
  token: TOKEN,
  path: PATH,
  validate: Array.isArray,
  empty: [],
  backoffMs: 1,
  readAttempts: 1,
  verifyDelaysMs: [0],
})

describe('readModifyWrite (rev 7: put() succeeding IS the write)', () => {
  it('normal write is confirmed on the first verify read (put once, verified true)', async () => {
    const store = makeStore(['a'])
    const result = await readModifyWrite({
      ...baseOpts(store),
      mutate: appendOnce('b'),
      confirm: confirmHas('b'),
    })
    assert.deepEqual(result, { value: ['a', 'b'], verified: true })
    assert.equal(store.putCalls.length, 1)
    assert.equal(store.putCalls[0].opts.cacheControlMaxAge, 0, 'writes must not be edge-cached afterwards')
    // The verify re-read uses a cache-busting URL, the initial read does not.
    assert.ok(store.fetchUrls[1].includes('v='), 'verify fetch must bust the cache')
    assert.ok(!store.fetchUrls[0].includes('v='), 'initial read uses the plain URL')
  })

  it('lagging reads (never visible in the verify window) still return the written value with verified:false — NEVER a 503 (the rev 6 regression)', async () => {
    const store = makeStore(['a'])
    store.setAutoSync(false)
    const result = await readModifyWrite({
      ...baseOpts(store),
      verifyDelaysMs: [0, 1, 2],
      mutate: appendOnce('b'),
      confirm: confirmHas('b'),
    })
    assert.deepEqual(result, { value: ['a', 'b'], verified: false })
    assert.equal(store.putCalls.length, 1, 'the write landed once; the lag is a read problem, not a write failure')
    assert.deepEqual(store.real, ['a', 'b'], 'the store really holds the write')
  })

  it('verify becomes visible inside the budget -> verified true', async () => {
    const store = makeStore(['a'])
    store.setAutoSync(false)
    store.setSyncOnFetchCall(3)
    const result = await readModifyWrite({
      ...baseOpts(store),
      verifyDelaysMs: [0, 1, 2],
      mutate: appendOnce('b'),
      confirm: confirmHas('b'),
    })
    assert.deepEqual(result, { value: ['a', 'b'], verified: true })
    assert.equal(store.putCalls.length, 1)
  })

  it('put throwing transiently retries and then confirms', async () => {
    const store = makeStore(['a'])
    store.failPutTimes(1)
    const result = await readModifyWrite({
      ...baseOpts(store),
      mutate: appendOnce('b'),
      confirm: confirmHas('b'),
    })
    assert.deepEqual(result, { value: ['a', 'b'], verified: true })
    assert.equal(store.putCalls.length, 2, 'one failed put + one good put')
  })

  it('put throwing on every attempt -> BlobWriteError 503 with the write-failed code', async () => {
    const store = makeStore(['a'])
    store.failPutTimes(99)
    await assert.rejects(
      () => readModifyWrite({
        ...baseOpts(store),
        writeFailedCode: 'thesis_store_write_failed',
        mutate: appendOnce('b'),
        confirm: confirmHas('b'),
      }),
      (error) => error instanceof BlobWriteError && error.code === 'thesis_store_write_failed' && error.status === 503,
    )
    assert.equal(store.putCalls.length, 3, 'all three attempts must be tried before giving up')
  })

  it('put throwing AFTER landing: the retry read shows it, the idempotent mutate short-circuits, no second put', async () => {
    const store = makeStore(['a'])
    store.setAutoSync(false)
    store.setSyncOnFetchCall(2)
    store.failPutAfterApplyTimes(1)
    const result = await readModifyWrite({
      ...baseOpts(store),
      mutate: appendOnce('b'),
      confirm: confirmHas('b'),
    })
    assert.deepEqual(result, { value: ['a', 'b'], verified: true })
    assert.equal(store.putCalls.length, 1, 'the retry must not write twice when the first put already landed')
  })

  it('mutate throwing FailRequest propagates immediately, put never called', async () => {
    const store = makeStore(['a'])
    await assert.rejects(
      () => readModifyWrite({
        ...baseOpts(store),
        mutate: () => { throw new FailRequest(401, { error: 'Missing edit token.', code: 'edit_token_required' }) },
        confirm: confirmHas('b'),
      }),
      (error) => error instanceof FailRequest && error.status === 401 && error.body.code === 'edit_token_required',
    )
    assert.equal(store.putCalls.length, 0)
  })

  it('failed initial read on every attempt -> BlobReadError, put never called (rev 4 guarantee kept)', async () => {
    const store = makeStore(['a'])
    const list = async () => { throw new Error('Blob list unavailable') }
    await assert.rejects(
      () => readModifyWrite({
        ...baseOpts(store),
        list,
        readAttempts: 2,
        mutate: appendOnce('b'),
        confirm: confirmHas('b'),
      }),
      (error) => error instanceof BlobReadError && error.code === 'blob_unavailable' && error.status === 503,
    )
    assert.equal(store.putCalls.length, 0)
  })

  it('initial read failing once then succeeding -> the write proceeds', async () => {
    const store = makeStore(['a'])
    let calls = 0
    const list = async () => {
      calls++
      if (calls === 1) throw new Error('Blob list unavailable')
      return { blobs: [{ pathname: PATH, url: 'https://blob.test/theses.json' }] }
    }
    const result = await readModifyWrite({
      ...baseOpts(store),
      list,
      readAttempts: 3,
      mutate: appendOnce('b'),
      confirm: confirmHas('b'),
    })
    assert.deepEqual(result, { value: ['a', 'b'], verified: true })
    assert.equal(store.putCalls.length, 1)
  })

  it('pre-write reads are repeated and the freshest snapshot wins (a stale first read must not lose a newer record)', async () => {
    const store = makeStore(['a'])
    let calls = 0
    const fetchImpl = async () => {
      calls++
      // Once a put has happened, the store reflects it (a healthy
      // store must) — otherwise no verify could ever confirm.
      if (store.putCalls.length) return { ok: true, status: 200, headers: { get: () => "test-etag" }, json: async () => JSON.parse(store.putCalls.at(-1).body) }
      // Read 1 is stale (missing 'b'); read 2 is fresh. Timestamps
      // make the second snapshot fresher (updatedAt is newer).
      const value = calls === 1
        ? [{ id: 'x', updatedAt: '2026-11-26T08:00:00.000Z' }]
        : [{ id: 'x', updatedAt: '2026-11-26T08:00:00.000Z' }, { id: 'y', updatedAt: '2026-11-26T08:01:00.000Z' }]
      return { ok: true, status: 200, headers: { get: () => "test-etag" }, json: async () => structuredClone(value) }
    }
    const result = await readModifyWrite({
      ...baseOpts(store),
      fetchImpl,
      readAttempts: 2,
      mutate: (current) => [...current, { id: 'z', updatedAt: '2026-11-26T08:02:00.000Z' }],
      confirm: (written, stored) => stored.some((row) => row.id === 'z'),
    })
    assert.deepEqual(result.value.map((row) => row.id), ['x', 'y', 'z'], 'the mutate must run on the fresh snapshot, not the stale first read')
    assert.equal(result.verified, true)
    assert.equal(store.putCalls.length, 1)
  })

  it('mutate returning the same reference is a no-op: no put, current value returned, verified true', async () => {
    const store = makeStore(['a', 'b'])
    const result = await readModifyWrite({
      ...baseOpts(store),
      mutate: (current) => current,
      confirm: confirmHas('b'),
    })
    assert.deepEqual(result, { value: ['a', 'b'], verified: true })
    assert.equal(store.putCalls.length, 0)
  })

  it('no confirm function: put success alone reports verified true', async () => {
    const store = makeStore(['a'])
    const result = await readModifyWrite({
      ...baseOpts(store),
      mutate: appendOnce('b'),
    })
    assert.deepEqual(result, { value: ['a', 'b'], verified: true })
    assert.equal(store.putCalls.length, 1)
  })
})
