// Preserve the existing registry field's legacy heuristic. This is not an
// assessed investment-risk rating and must never be labeled data availability.
export function legacyProofScore(asset, now = Date.now()) {
  const price = Number(String(asset?.price || '').replace(/[$,]/g, ''))
  const supply = Number(asset?.totalSupply || 0)
  const timestamp = Date.parse(asset?.navUpdatedAt || '')
  const hours = Number.isFinite(timestamp) ? Math.max(0, (now - timestamp) / 36e5) : Infinity
  const freshness = Number.isFinite(hours) ? Math.round(Math.max(0, Math.min(30, 30 - hours * 2))) : 0
  const supplySignal = Number.isFinite(price) && price > 0 && supply > 0 ? Math.round(Math.max(0, Math.min(35, Math.log10(Math.max(1, price * supply)) * 5))) : 0
  const history = asset?.dataQuality?.history === true ? 10 : 0
  const change = asset?.dataQuality?.change === true ? 5 : 0
  const paused = Array.isArray(asset?.pausedFeatures) && asset.pausedFeatures.length ? -25 : 0
  return Math.round(Math.max(0, Math.min(100, 35 + freshness + supplySignal + history + change + paused)))
}
