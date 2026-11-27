import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dataQualityScore } from '../src/data-quality.js'
const now = Date.parse('2026-11-27T12:00:00Z')
test('availability score reflects source freshness and missing fields, not supply or risk', () => {
  const base = {price:'$100', navUpdatedAt:'2026-11-27T10:00:00Z', dataQuality:{nav:true,history:false,change:false}}
  assert.equal(dataQualityScore(base,now),25)
  assert.equal(dataQualityScore({...base,totalSupply:1e15,risk:'Lower'},now),25)
  assert.equal(dataQualityScore({...base,navUpdatedAt:'2026-11-27T11:30:00Z'},now),50)
  assert.equal(dataQualityScore({...base,navHistory:[{price:1},{price:2},{price:3}]},now),50)
  assert.equal(dataQualityScore({...base,price:'—',dataQuality:{nav:false}},now),0)
})
