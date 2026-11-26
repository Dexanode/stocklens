// Unit tests for readModifyWrite in api/lib/blob-store.js (rev 6).
//
// The helper runs read -> mutate -> put -> verify-re-read, retrying the
// whole cycle when the verify read does not show the mutation, and throws
// BlobWriteError (never a false 200) when no attempt confirms. The fake
// store below separates what put() wrote (`real`) from what fetch()
// returns (`visible`), so a test can simulate the stale reads observed
// live 26 Nov 2026 by lagging `visible` behind `real`.
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
    return { ok: true, status: 200, json: async () => structuredClone(visible) }
  }
  const list = async () => ({ blobs: [{ pathname: PATH, url: 'https://blob.test/theses.json' }] })
  const putCalls = []
  let failPutTimes = 0
  const put = async (path, body, opts) => {
    putCalls.push({ path, body, opts })
    if (failPutTimes > 0) {
      failPutTimes--
      throw new Error('put transport failed')
    }
    real = JSON.parse(body)
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
})

describe('readModifyWrite', () => {
  it('normal write is confirmed on the first attempt (put called once)', async () => {
    const store = makeStore(['a'])
    const result = await readModifyWrite({
      ...baseOpts(store),
      mutate: appendOnce('b'),
      confirm: confirmHas('b'),
    })
    assert.deepEqual(result, ['a', 'b'])
    assert.equal(store.putCalls.length, 1)
    assert.equal(store.putCalls[0].opts.cacheControlMaxAge, 0, 'writes must not be edge-cached afterwards')
    // The confirm re-read uses a cache-busting URL, the initial read does not.
    assert.ok(store.fetchUrls[1].includes('v='), 'verify fetch must bust the cache')
    assert.ok(!store.fetchUrls[0].includes('v='), 'initial read uses the plain URL')
  })

  it('stale verify read retries; an idempotent mutate short-circuits on the fresh read (put once)', async () => {
    const store = makeStore(['a'])
    store.setAutoSync(false)
    store.setSyncOnFetchCall(3)
    const result = await readModifyWrite({
      ...baseOpts(store),
      mutate: appendOnce('b'),
      confirm: confirmHas('b'),
    })
    assert.deepEqual(result, ['a', 'b'])
    assert.equal(store.putCalls.length, 1, 'the retry must not write twice when the first put already landed')
  })

  it('stale reads on both attempts retry the put; a fresh verify then confirms (put twice)', async () => {
    const store = makeStore(['a'])
    store.setAutoSync(false)
    store.setSyncOnFetchCall(4)
    const result = await readModifyWrite({
      ...baseOpts(store),
      mutate: appendOnce('b'),
      confirm: confirmHas('b'),
    })
    assert.deepEqual(result, ['a', 'b'])
    assert.equal(store.putCalls.length, 2, 'each unconfirmed attempt re-runs the whole cycle')
  })

  it('verify never confirms -> BlobWriteError 503, never a success', async () => {
    const store = makeStore(['a'])
    store.setAutoSync(false)
    await assert.rejects(
      () => readModifyWrite({
        ...baseOpts(store),
        notConfirmedCode: 'thesis_store_not_confirmed',
        mutate: appendOnce('b'),
        confirm: confirmHas('b'),
      }),
      (error) => error instanceof BlobWriteError && error.code === 'thesis_store_not_confirmed' && error.status === 503,
    )
    assert.equal(store.putCalls.length, 3, 'all three attempts must be tried before giving up')
  })

  it('put throwing transiently retries and then confirms', async () => {
    const store = makeStore(['a'])
    store.setAutoSync(false)
    store.setSyncOnFetchCall(3)
    store.failPutTimes(1)
    const result = await readModifyWrite({
      ...baseOpts(store),
      mutate: appendOnce('b'),
      confirm: confirmHas('b'),
    })
    assert.deepEqual(result, ['a', 'b'])
    assert.equal(store.putCalls.length, 2, 'one failed put + one good put')
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

  it('failed initial read -> BlobReadError, put never called (rev 4 guarantee kept)', async () => {
    const store = makeStore(['a'])
    const list = async () => { throw new Error('Blob list unavailable') }
    await assert.rejects(
      () => readModifyWrite({
        ...baseOpts(store),
        list,
        mutate: appendOnce('b'),
        confirm: confirmHas('b'),
      }),
      (error) => error instanceof BlobReadError && error.code === 'blob_unavailable' && error.status === 503,
    )
    assert.equal(store.putCalls.length, 0)
  })

  it('mutate returning the same reference is a no-op: no put, current value returned', async () => {
    const store = makeStore(['a', 'b'])
    const result = await readModifyWrite({
      ...baseOpts(store),
      mutate: (current) => current,
      confirm: confirmHas('b'),
    })
    assert.deepEqual(result, ['a', 'b'])
    assert.equal(store.putCalls.length, 0)
  })
})
