import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MISSING_CHANGE_BPS, proofChangeBps, displayProofChange } from '../src/proof-change.js'
test('distinguishes missing comparison from actual zero in new proofs', () => {
  assert.equal(proofChangeBps('N/A'), MISSING_CHANGE_BPS)
  assert.equal(proofChangeBps('0.00%'), 0)
  assert.equal(proofChangeBps('-1.23%'), -123)
  assert.equal(displayProofChange(null), 'Unavailable')
  assert.equal(displayProofChange(0), '0% or unavailable')
})
