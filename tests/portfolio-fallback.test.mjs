import { test } from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/portfolio.js'

const universe = [{ symbol: 'AAPLc', price: '$100', score: 70, dataQuality: { nav: true } }]

async function run(fetchImpl) {
  const previousFetch = globalThis.fetch
  const previousKey = process.env.VIKEY_API_KEY
  globalThis.fetch = fetchImpl
  process.env.VIKEY_API_KEY = 'test-key'
  const response = {
    setHeader() {},
    status(code) { this.code = code; return this },
    json(body) { this.body = body; return this },
  }
  try {
    await handler({ method: 'POST', headers: {}, body: { universe, holdings: [] } }, response)
    return response
  } finally {
    globalThis.fetch = previousFetch
    if (previousKey === undefined) delete process.env.VIKEY_API_KEY
    else process.env.VIKEY_API_KEY = previousKey
  }
}

test('fallback distinguishes provider error, timeout, invalid JSON and invalid allocation', async () => {
  const cases = [
    [async () => ({ ok: false, status: 502 }), 'upstream_http_error'],
    [async () => { throw Object.assign(new Error('sensitive detail'), { name: 'TimeoutError' }) }, 'upstream_timeout'],
    [async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'not json' } }] }) }), 'invalid_model_response'],
    [async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ summary: 'test', actions: [], allocations: [] }) } }] }) }), 'invalid_allocation'],
  ]
  for (const [fetchImpl, reason] of cases) {
    const result = await run(fetchImpl)
    assert.equal(result.code, 200)
    assert.equal(result.body.fallback, true)
    assert.equal(result.body.fallbackReason, reason)
    assert.equal(JSON.stringify(result.body).includes('sensitive detail'), false)
  }
})
