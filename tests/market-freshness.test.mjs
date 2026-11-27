import { test } from 'node:test'
import assert from 'node:assert/strict'
import { navFreshness } from '../src/market-freshness.js'
import market from '../api/market.js'

test('marks missing, delayed, future and current source timestamps accurately', () => {
  const now = Date.parse('2026-11-27T12:00:00Z')
  const item = { price: '$100', dataQuality: { nav: true } }
  assert.equal(navFreshness(item, now), 'unknown')
  assert.equal(navFreshness({ ...item, navUpdatedAt: '2026-11-27T11:30:00Z' }, now), 'current')
  assert.equal(navFreshness({ ...item, navUpdatedAt: '2026-11-27T10:00:00Z' }, now), 'delayed')
  assert.equal(navFreshness({ ...item, navUpdatedAt: '2026-11-27T13:00:00Z' }, now), 'unknown')
  assert.equal(navFreshness({ ...item, price: '—' }, now), 'unavailable')
})

test('missing comparison data is not reported as zero change', async () => {
  const oldFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ tokens: [{ symbol: 'AAPLc', contract_address: '0xabc', nav_price: '100', price_change_24h: null }] }) })
  const response = { setHeader() {}, status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
  try {
    await market({ headers: {} }, response)
    assert.equal(response.body.data.AAPLc.change, 'N/A')
    assert.equal(response.body.data.AAPLc.dataQuality.change, false)
  } finally { globalThis.fetch = oldFetch }
})
