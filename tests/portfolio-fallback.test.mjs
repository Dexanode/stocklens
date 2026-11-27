import { test } from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/portfolio.js'

let requestIndex = 0
const universe = [{ symbol: 'AAPLc', price: '$100', score: 70, dataQuality: { nav: true } }]

async function run(fetchImpl, input = { universe, holdings: [] }) {
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
    await handler({ method: 'POST', headers: { 'x-forwarded-for': `test-${requestIndex++}` }, body: input }, response)
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

test('preserves all 13 holdings and validates the exact allocation sent to the UI', async () => {
  const universe = Array.from({ length: 13 }, (_, index) => ({ symbol: 'T' + index, price: '$10' }))
  const holdings = universe.map(({ symbol }) => ({ symbol, units: 1, notional: 10 }))
  const valid = universe.map(({ symbol }, index) => ({ symbol, targetPercent: index === 0 ? 100 : 0 }))
  for (const scenario of ['valid', 'duplicate', 'fractional', 'out-of-range', 'no-nav']) {
    const allocations = structuredClone(valid)
    if (scenario === 'duplicate') allocations[12].symbol = allocations[11].symbol
    if (scenario === 'fractional') Object.assign(allocations[0], { targetPercent: 99.6 })
    if (scenario === 'out-of-range') {
      allocations[0].targetPercent = 101
      allocations[1].targetPercent = -1
    }
    if (scenario === 'no-nav') universe[0].dataQuality = { nav: false }
    const result = await run(async (_url, options) => {
      const prompt = JSON.parse(JSON.parse(options.body).messages[1].content)
      assert.deepEqual(prompt.currentPaperHoldings, holdings)
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ summary: 'test', actions: [], allocations }) } }] }) }
    }, { universe, holdings })
    assert.equal(result.body.fallback, scenario !== 'valid', scenario)
    assert.equal(result.body.allocations.reduce((sum, row) => sum + row.targetPercent, 0), 100)
  }
})

test('portfolio confidence is capped by the available inputs of selected assets', async () => {
  const result = await run(async (_url, options) => {
    const prompt = JSON.parse(JSON.parse(options.body).messages[1].content)
    assert.equal(prompt.universe[0].risk, 'Unknown')
    assert.equal(prompt.universe[0].score, 25)
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ summary: 'Data-limited plan', actions: [], allocations: [{symbol:'AAPLc',targetPercent:100,reason:'NAV available'}], confidence: 99 }) } }] }) }
  })
  assert.equal(result.body.fallback, false)
  assert.equal(result.body.confidence, 25)
})

test('portfolio rejects unsupported risk claims', async () => {
  const result = await run(async () => ({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({summary:'A low-risk allocation.',actions:[],allocations:[{symbol:'AAPLc',targetPercent:100}]})}}]})}))
  assert.equal(result.body.fallback, true)
  assert.equal(result.body.fallbackReason, 'unsupported_risk_claim')
})
