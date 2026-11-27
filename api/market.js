import { isBlockedCountry } from './lib/geo.js'
import { dataQualityScore } from '../src/data-quality.js'

const palette = [
  ['blue', '#2457ff'], ['cyan', '#00a9ba'], ['coral', '#ff6b52'],
  ['violet', '#7959f5'], ['green', '#1b8a5a'],
]

const fallback = {
  AAPLc: '0xb200000000000000000000C2e324d24d7eEcd1fb',
  METAc: '0xb2000000000000000000008bC8786B856E61707C',
  TSLAc: '0xb2000000000000000000001e800a7f5189430cD0',
  NVDAc: '0xb20000000000000000000078ee7ce2fE4908108C',
}

function toneFor(symbol) {
  let hash = 0
  for (const char of symbol) hash = (hash * 31 + char.charCodeAt(0)) % palette.length
  return palette[hash]
}

function normalize(token, index) {
  const symbol = String(token.symbol || '')
  const price = Number(token.nav_price)
  if (!symbol || !token.contract_address || !Number.isFinite(price) || price <= 0) return null
  const [tone, color] = toneFor(symbol)
  const rawChange = token.change_24h ?? token.nav_change_24h ?? token.price_change_24h
  const hasChange = rawChange !== null && rawChange !== undefined && String(rawChange).trim() !== '' && Number.isFinite(Number(rawChange))
  const change = hasChange ? `${Number(rawChange).toFixed(2)}%` : 'N/A'
  const updatedAt = token.nav_price_updated_at || null
  const dataQuality = { nav: true, history: Array.isArray(token.nav_history) && token.nav_history.length >= 3, change: hasChange }
  const score = dataQualityScore({ price, navUpdatedAt: updatedAt, dataQuality })
  return [symbol, {
    name: token.name || symbol, ticker: symbol, sector: 'Tokenized equity / B20',
    price: `$${price.toFixed(2)}`, change, tone, risk: 'Unknown', score,
    volume: Number.isFinite(Number(token.total_supply)) ? `${Number(token.total_supply).toLocaleString()} supply` : 'Supply unavailable',
    time: updatedAt ? new Date(updatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }) : 'NAV time unavailable',
    bull: 'A NAV reference and B20 contract address are available on Base mainnet.',
    bear: token.paused_features?.length ? 'The token reports paused features; treat the reference as constrained.' : 'NAV is a reference value, not a bid, ask, or guaranteed fill price.',
    color, points: '', candles: [], navHistory: Array.isArray(token.nav_history) ? token.nav_history : [],
    contractAddress: token.contract_address, chainId: 8453, dataSource: 'Coinbase Tokenized Stocks API',
    navUpdatedAt: updatedAt, totalSupply: token.total_supply ?? null, multiplier: token.multiplier ?? null,
    pausedFeatures: token.paused_features || [],
    dataQuality, index,
  }]
}

async function fetchAllTokens() {
  const tokens = []
  let pageToken = ''
  for (let page = 0; page < 5; page += 1) {
    const query = `?include_zero_supply=false${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`
    const result = await fetch(`https://api.coinbase.com/v1/tokenized-stocks${query}`, { signal: AbortSignal.timeout(8000) })
    if (!result.ok) throw new Error(`tokenized_stocks_${result.status}`)
    const payload = await result.json()
    tokens.push(...(payload.tokens || []))
    pageToken = payload.next_page_token || ''
    if (!pageToken) break
  }
  return tokens
}

export default async function handler(request, response) {
  // Geo-block enforced from the Vercel IP header, not the self-declared
  // client header (audit C-3). Previously this route had no geo check at all.
  // Note: on a 451 the frontend falls back to its local demo-data mode
  // (hardcoded, no live NAV) — see PR notes.
  if (isBlockedCountry(request).blocked) return response.status(451).json({ error: 'Research access is unavailable in the United States.' })
  try {
    const tokens = await fetchAllTokens()
    const data = Object.fromEntries(tokens.map(normalize).filter(Boolean))
    response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    return response.status(200).json({ source: 'Coinbase Tokenized Stocks API', chainId: 8453, data, count: Object.keys(data).length })
  } catch (error) {
    const data = Object.fromEntries(Object.entries(fallback).map(([symbol, contractAddress], index) => {
      const [tone, color] = toneFor(symbol)
      return [symbol, { name: symbol.replace('c', ''), ticker: symbol, sector: 'Tokenized equity / B20', price: '—', change: 'N/A', tone, risk: 'Unknown', score: null, volume: 'Reference unavailable', time: 'Registry fallback', bull: 'Verified B20 contract identity is available on Base mainnet.', bear: 'Live NAV is temporarily unavailable; no price claim is shown.', color, points: '', candles: [], navHistory: [], contractAddress, chainId: 8453, dataSource: 'Base B20 registry fallback', dataQuality: { nav: false, history: false, change: false }, index }]
    }))
    response.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60')
    return response.status(200).json({ source: 'Base B20 registry fallback', chainId: 8453, warning: error.message, data, count: Object.keys(data).length })
  }
}
