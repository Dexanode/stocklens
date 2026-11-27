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
