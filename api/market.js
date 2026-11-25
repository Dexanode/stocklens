const registry = {
  AAPLc: { name: 'Apple', tone: 'blue', color: '#2457ff' },
  METAc: { name: 'Meta', tone: 'cyan', color: '#00b8c8' },
  TSLAc: { name: 'Tesla', tone: 'coral', color: '#ff6b52' },
  NVDAc: { name: 'NVIDIA', tone: 'violet', color: '#7959f5' },
}

const fallback = {
  AAPLc: '0xb200000000000000000000C2e324d24d7eEcd1fb',
  METAc: '0xb2000000000000000000008bC8786B856E61707C',
  TSLAc: '0xb2000000000000000000001e800a7f5189430cD0',
  NVDAc: '0xb20000000000000000000078ee7ce2fE4908108C',
}

function flatPoints() {
  return Array.from({ length: 16 }, (_, index) => `${index * 48 + 4},42`).join(' ')
}

function normalize(token) {
  const symbol = token.symbol
  const meta = registry[symbol]
  if (!meta || !token.contract_address) return null
  const price = Number(token.nav_price)
  return [symbol, {
    name: token.name || meta.name,
    ticker: symbol,
    sector: 'Tokenized equity / B20',
    price: Number.isFinite(price) ? `$${price.toFixed(2)}` : '—',
    change: '—',
    tone: meta.tone,
    risk: 'Moderate',
    score: 50,
    volume: 'B20 NAV reference',
    time: token.nav_price_updated_at ? new Date(token.nav_price_updated_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'Reference pending',
    bull: 'The asset is identified by a verified Coinbase B20 contract on Base.',
    bear: 'NAV is a reference value, not a bid, ask, or guaranteed fill price.',
    color: meta.color,
    points: flatPoints(),
    candles: [],
    contractAddress: token.contract_address,
    chainId: 8453,
    dataSource: 'Coinbase Tokenized Stocks API',
    navUpdatedAt: token.nav_price_updated_at || null,
  }]
}

export default async function handler(_request, response) {
  try {
    const upstream = await fetch('https://api.coinbase.com/v1/tokenized-stocks?include_zero_supply=false', { signal: AbortSignal.timeout(8000) })
    if (!upstream.ok) throw new Error(`tokenized_stocks_${upstream.status}`)
    const payload = await upstream.json()
    const data = Object.fromEntries((payload.tokens || []).map(normalize).filter(Boolean))
    response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    return response.status(200).json({ source: 'Coinbase Tokenized Stocks API', chainId: 8453, data })
  } catch (error) {
    const data = Object.fromEntries(Object.entries(registry).map(([symbol, meta]) => [symbol, {
      name: meta.name,
      ticker: symbol,
      sector: 'Tokenized equity / B20',
      price: '—',
      change: '—',
      tone: meta.tone,
      risk: 'Unknown',
      score: 50,
      volume: 'Reference unavailable',
      time: 'Registry fallback',
      bull: 'Verified B20 contract identity is available on Base mainnet.',
      bear: 'Live NAV is temporarily unavailable; no price claim is shown.',
      color: meta.color,
      points: flatPoints(),
      candles: [],
      contractAddress: fallback[symbol],
      chainId: 8453,
      dataSource: 'Base B20 registry fallback',
    }]))
    response.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60')
    return response.status(200).json({ source: 'Base B20 registry fallback', chainId: 8453, warning: error.message, data })
  }
}
