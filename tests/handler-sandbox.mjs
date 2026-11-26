// Shared helper for handler integration tests (rev 4).
//
// The api/ handlers import '@vercel/blob', which is not installed in this
// checkout, so each test loads the handler from an isolated temp copy of
// api/ with a stubbed @vercel/blob package. The stub's list()/put()
// behaviour is driven through globalThis.__stocklensBlobStub, which the
// test sets per case; putCalls records every put() so a test can prove a
// failed read never caused a write (the rev 4 guarantee).
//
// Usage:
//   const { handler, stub, cleanup } = await loadHandler('thesis.js')
//   stub.list = async (opts) => ({ blobs: [{ pathname: opts.prefix, url: 'https://blob.test/x' }] })
//   globalThis.fetch = async (url) => ({ ok: true, status: 200, json: async () => [...] })
//   const res = fakeResponse()
//   await handler(fakeRequest({ method: 'POST', body: {...} }), res)
//   assert.equal(stub.putCalls.length, 0)
//   await cleanup()
import { mkdtemp, cp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

export function fakeResponse() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this },
    json(obj) { this.body = obj; return this },
    setHeader(key, value) { this.headers[key] = value },
  }
  return res
}

export function fakeRequest({ method, url, query = {}, headers = {}, body = undefined }) {
  // `url` is the raw request URL (e.g. '/api/thesis?id=th_x'); rev 5 reads
  // the GET id from it. Older tests omit it and rely on `query` instead.
  return { method, url, query, headers, body }
}

export async function loadHandler(entry) {
  const dir = await mkdtemp(join(tmpdir(), 'stocklens-handler-test-'))
  await cp(join(repoRoot, 'api'), join(dir, 'api'), { recursive: true })
  await mkdir(join(dir, 'node_modules', '@vercel', 'blob'), { recursive: true })
  await writeFile(
    join(dir, 'node_modules', '@vercel', 'blob', 'package.json'),
    JSON.stringify({ name: '@vercel/blob', version: '0.0.0-stub', type: 'module', main: 'index.mjs', exports: { '.': './index.mjs' } }),
  )
  await writeFile(
    join(dir, 'node_modules', '@vercel', 'blob', 'index.mjs'),
    `export async function list(opts) { return globalThis.__stocklensBlobStub.list(opts) }\n` +
      `export async function head() { return { etag: 'test-etag' } }\n` +
      `export async function get(path) { const result = await globalThis.fetch('https://blob.test/' + path); if (!result.ok) { if (result.status === 404) return null; throw new Error('Blob fetch failed') } let body; try { body = JSON.stringify(await result.json()) } catch { body = '{invalid' } return { statusCode: 200, stream: new Response(body).body, blob: { etag: result.headers?.get?.('etag') || 'test-etag' } } }\n` +
      `export async function put(path, body, opts) {\n` +
      `  const stub = globalThis.__stocklensBlobStub\n` +
      `  if (stub.failPutTimes > 0) { stub.failPutTimes--; throw new Error('put transport failed') }\n` +
      `  if (stub.failPutAfterApplyTimes > 0) { stub.failPutAfterApplyTimes--; stub.putCalls.push({ path, body, opts }); throw new Error('put transport failed after write') }\n` +
      `  stub.putCalls.push({ path, body, opts }); return { url: 'https://blob.test/' + path }\n` +
      `}\n`,
  )
  const stub = { putCalls: [], failPutTimes: 0, failPutAfterApplyTimes: 0, list: async () => ({ blobs: [] }) }
  globalThis.__stocklensBlobStub = stub
  const mod = await import(pathToFileURL(join(dir, 'api', entry)).href)
  return { handler: mod.default, stub, dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}
