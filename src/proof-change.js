// Reserved int256 value for a missing source comparison, stored in basis points.
export const MISSING_CHANGE_BPS = -2147483648
export function proofChangeBps(change) {
  const text = String(change ?? '').trim()
  if (!/^[+-]?\d+(?:\.\d+)?%$/.test(text)) return MISSING_CHANGE_BPS
  const value = Number(text.slice(0, -1))
  return Number.isFinite(value) ? Math.round(value * 100) : MISSING_CHANGE_BPS
}
export function displayProofChange(change) {
  if (change === null || !Number.isFinite(change)) return 'Unavailable'
  if (change === 0) return '0% or unavailable (legacy)'
  return `${change > 0 ? '+' : ''}${change.toFixed(2)}%`
}
