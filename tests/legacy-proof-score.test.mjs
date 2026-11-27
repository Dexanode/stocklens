import { test } from 'node:test'
import assert from 'node:assert/strict'
import { legacyProofScore } from '../src/legacy-proof-score.js'

test('retains the legacy 0–100 heuristic independently of data-availability score', () => {
  const now = Date.parse('2026-11-27T12:00:00Z')
  const asset = { price:'$100', totalSupply:10000, navUpdatedAt:'2026-11-27T10:00:00Z', dataQuality:{history:false,change:false}, pausedFeatures:[] }
  assert.equal(legacyProofScore(asset, now), 91)
  assert.equal(legacyProofScore({ ...asset, dataQuality:{history:true,change:true} }, now), 100)
  assert.equal(legacyProofScore({ ...asset, pausedFeatures:['paused'] }, now), 66)
})
