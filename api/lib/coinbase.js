// Minimal read-only client for the Coinbase Tokenized Stocks API, shared by
// routes that need a live NAV reference for validation (nav-history).
// Same endpoint and pagination behaviour as api/market.js `fetchAllTokens`.
// No API key required. Prices are never hardcoded here.

const ENDPOINT = 'https://api.coinbase.com/v1/tokenized-stocks'

export async function fetchLiveNav() {
  const prices = new Map() // symbol -> live NAV price (number)
  let pageToken = ''
  for (let page = 0; page < 5; page += 1) {
    const query = `?include_zero_supply=false${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`
    const result = await fetch(`${ENDPOINT}${query}`, { signal: AbortSignal.timeout(8000) })
    if (!result.ok) throw new Error(`tokenized_stocks_${result.status}`)
    const payload = await result.json()
    for (const token of payload.tokens || []) {
      const price = Number(token?.nav_price)
      if (token?.symbol && Number.isFinite(price) && price > 0) prices.set(String(token.symbol), price)
    }
    pageToken = payload.next_page_token || ''
    if (!pageToken) break
  }
  return prices
}
