import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readBlobJson, readModifyWrite } from '../api/lib/blob-store.js'

test('a listed blob returning 404 cannot be treated as empty', async () => {
  await assert.rejects(readBlobJson({
    path: 'test', token: 'test',
    list: async () => ({ blobs: [{ pathname: 'test', url: 'https://example.test/blob' }] }),
    fetchImpl: async () => ({ ok: false, status: 404 }),
  }), { name: 'BlobReadError', status: 503 })
})

test('concurrent writers retry conditional writes without dropping either update', async () => {
  let value = []
  let version = 1
  let conflicts = 0
  const list = async () => ({ blobs: [{ pathname: 'test', url: 'https://example.test/blob' }] })
  const fetchImpl = async () => {
    const snapshot = structuredClone(value)
    const etag = String(version)
    return { ok: true, headers: { get: () => etag }, json: async () => snapshot }
  }
  const put = async (_path, body, options) => {
    if (options.ifMatch !== String(version)) {
      conflicts++
      throw new Error('precondition failed')
    }
    value = JSON.parse(body)
    version++
  }
  const write = (item) => readModifyWrite({
    list, put, fetchImpl, token: 'test', path: 'test', validate: Array.isArray,
    empty: [], readAttempts: 1, backoffMs: 1, verifyDelaysMs: [0],
    mutate: (rows) => rows.includes(item) ? rows : [...rows, item],
  })
  await Promise.all([write('first'), write('second')])
  assert.deepEqual(value.sort(), ['first', 'second'])
  assert.ok(conflicts >= 1)
})

test('a read without an ETag cannot overwrite an existing blob', async () => {
  let writes = 0
  await assert.rejects(readModifyWrite({
    list: async () => ({ blobs: [{ pathname: 'test', url: 'https://example.test/blob' }] }),
    fetchImpl: async () => ({ ok: true, json: async () => [] }),
    put: async () => { writes++ }, token: 'test', path: 'test',
    validate: Array.isArray, empty: [], readAttempts: 1, mutate: () => ['new'],
  }), { name: 'BlobReadError', status: 503 })
  assert.equal(writes, 0)
})
