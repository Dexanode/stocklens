import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paperPosition, paperPlanIsValid } from '../src/paper-validation.js'
test('paper positions require a positive budget and available positive NAV', () => {
  const item = { price: '$100', dataQuality: { nav: true } }
  assert.deepEqual(paperPosition('AAPLc', item, 1000), { symbol: 'AAPLc', units: 10, notional: 1000, entryPrice: 100 })
  for (const bad of [0, -1, NaN, Infinity]) assert.equal(paperPosition('AAPLc', item, bad), null)
  for (const bad of ['—', '', '$0']) assert.equal(paperPosition('AAPLc', { price: bad }, 100), null)
  assert.equal(paperPosition('AAPLc', { ...item, dataQuality: { nav: false } }, 100), null)
})
test('applying a plan fails closed when any position is invalid', () => {
  const valid = paperPosition('AAPLc', { price: '$100' }, 100)
  assert.equal(paperPlanIsValid([valid], 100), true)
  assert.equal(paperPlanIsValid([valid, { ...valid, entryPrice: null }], 100), false)
  assert.equal(paperPlanIsValid([valid], 0), false)
})
