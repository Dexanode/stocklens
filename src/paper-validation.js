export function paperPosition(symbol, item, budget) {
  const price = Number(String(item?.price ?? '').replace(/[$,]/g, ''))
  const amount = Number(budget)
  if (!symbol || item?.dataQuality?.nav === false || !Number.isFinite(price) || price <= 0 || !Number.isFinite(amount) || amount <= 0) return null
  const units = amount / price
  if (!Number.isFinite(units) || units <= 0) return null
  return { symbol, units, notional: amount, entryPrice: price }
}
export function paperPlanIsValid(positions, budget) {
  return Number.isFinite(Number(budget)) && Number(budget) > 0 && positions.length > 0 && positions.every((item) => item && Number.isFinite(item.entryPrice) && item.entryPrice > 0 && Number.isFinite(item.units) && item.units > 0 && Number.isFinite(item.notional) && item.notional > 0)
}
