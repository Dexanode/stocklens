import { test } from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/risk.js'

async function run(asset, fetchImpl) {
  const originalFetch = globalThis.fetch
  const key = process.env.VIKEY_API_KEY
  globalThis.fetch = fetchImpl
  process.env.VIKEY_API_KEY = 'test-key'
  const res = { setHeader() {}, status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
  try { await handler({ method: 'POST', headers: {}, body: { asset } }, res); return res.body }
  finally { globalThis.fetch = originalFetch; if (key === undefined) delete process.env.VIKEY_API_KEY; else process.env.VIKEY_API_KEY = key }
}
const item = {symbol:'AAPLc', price:'$100', change:'N/A', dataQuality:{nav:true,history:false,change:false}}
test('stale and unknown NAV use deterministic wording and cannot call the model', async () => {
  for (const navUpdatedAt of [new Date(Date.now()-2*3600e3).toISOString(), '']) {
    const response = await run({...item, navUpdatedAt}, async () => { throw new Error('model must not be called') })
    assert.equal(response.fallback, true)
    assert.ok(['delayed', 'unknown'].includes(response.navStatus))
    assert.doesNotMatch(JSON.stringify(response).toLowerCase(), /live nav|nav print is fresh/)
  }
})
test('current NAV passes computed status and timestamp to Vikey', async () => {
  let prompt
  const response = await run({...item, navUpdatedAt:new Date().toISOString()}, async (_url, options) => {
    prompt = JSON.parse(JSON.parse(options.body).messages[1].content)
    return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({summary:'Brief',bull:'Bull',bear:'Bear',risk:'Moderate',score:50,confidence:40,catalysts:[],risks:[]})}}]})}
  })
  assert.equal(prompt.navStatus, 'current')
  assert.equal(response.navStatus, 'current')
  assert.equal(response.fallback, false)
})
test('model confidence and asset risk are bounded by data availability', async () => {
  const response = await run({...item, navUpdatedAt:new Date().toISOString()}, async () => ({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({summary:'Available data is limited.',bull:'NAV available.',bear:'No trend history.',risk:'Lower',score:99,confidence:99,catalysts:[],risks:[]})}}]})}))
  assert.equal(response.risk,'Unknown')
  assert.equal(response.score,50)
  assert.equal(response.confidence,50)
  assert.equal(response.fallback,false)
})
test('unsupported low-risk model claims trigger a deterministic brief', async () => {
  const response = await run({...item, navUpdatedAt:new Date().toISOString()}, async () => ({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({summary:'This asset is low risk.',bull:'NAV available.',bear:'Unknown.',risk:'Lower',score:99,confidence:99,catalysts:[],risks:[]})}}]})}))
  assert.equal(response.fallback,true)
  assert.equal(response.risk,'Unknown')
  assert.match(response.summary,/risk is not assessed/)
})
