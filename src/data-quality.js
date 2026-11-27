import { navFreshness } from './market-freshness.js'

// Availability indicator, not an investment-risk score. Each check contributes 25 points.
export function dataQualityScore(asset, now = Date.now()) {
  const status = navFreshness(asset, now)
  const available = status !== 'unavailable'
  const hasHistory = asset?.dataQuality?.history === true || (Array.isArray(asset?.navHistory) && asset.navHistory.filter(row => Number.isFinite(Number(row?.price)) && Number(row.price) > 0).length >= 3)
  const hasChange = asset?.dataQuality?.change === true
  return (available ? 25 : 0) + (status === 'current' ? 25 : 0) + (hasHistory ? 25 : 0) + (hasChange ? 25 : 0)
}

// Preserve the most complete loaded history during a market-only refresh.
export function retainLoadedHistory(current, incoming) {
  const oldRows = Array.isArray(current) ? current : []
  const newRows = Array.isArray(incoming) ? incoming : []
  return oldRows.length > newRows.length ? oldRows : newRows
}
