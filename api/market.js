const symbols = {
  AAPLx: { ticker: 'AAPL', name: 'Apple' },
  COINx: { ticker: 'COIN', name: 'Coinbase' },
  TSLAx: { ticker: 'TSLA', name: 'Tesla' },
  NVDAx: { ticker: 'NVDA', name: 'NVIDIA' },
}

const toneBySymbol = { AAPLx: 'blue', COINx: 'cyan', TSLAx: 'coral', NVDAx: 'violet' }

export default async function handler(_request, response) {
  const entries = await Promise.all(Object.entries(symbols).map(async ([symbol, meta]) => {
    try {
      const upstream = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${meta.ticker}?range=1y&interval=1d`)
      if (!upstream.ok) throw new Error(`upstream_${upstream.status}`)
      const payload = await upstream.json()
      const result = payload.chart?.result?.[0]
      const quote = result?.indicators?.quote?.[0]
      const closes = (quote?.close || []).filter(Number.isFinite)
      const timestamps = result?.timestamp || []
      const candles = timestamps.map((timestamp, index) => ({ timestamp, open: quote?.open?.[index], high: quote?.high?.[index], low: quote?.low?.[index], close: quote?.close?.[index] })).filter((candle) => [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite))
      const price = closes.at(-1)
      const previous = closes.at(-2) || price
      if (!Number.isFinite(price)) throw new Error('missing_price')
      const change = ((price - previous) / previous) * 100
      const points = closes.map((value, index) => `${Math.round((index / Math.max(closes.length - 1, 1)) * 720) + 4},${Math.max(4, 82 - ((value - Math.min(...closes)) / Math.max(Math.max(...closes) - Math.min(...closes), 1)) * 74)}`).join(' ')
      return [symbol, { name: meta.name, ticker: meta.ticker, sector: symbol === 'COINx' ? 'Crypto exchange' : 'Tokenized equity', price: `$${price.toFixed(2)}`, change: `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`, tone: toneBySymbol[symbol], risk: change < -2 ? 'High' : Math.abs(change) > 3 ? 'Elevated' : 'Moderate', score: Math.max(35, Math.min(88, Math.round(68 + change * 4))), volume: 'Live quote', time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), bull: 'Live momentum is available for the current research pass.', bear: 'Short-term price movement is not a complete investment thesis.', color: { blue: '#2457ff', cyan: '#00b8c8', coral: '#ff6b52', violet: '#7959f5' }[toneBySymbol[symbol]], points, candles }]
    } catch {
      return [symbol, null]
    }
  }))

  const data = Object.fromEntries(entries.filter(([, value]) => value))
  response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
  response.status(200).json({ source: 'Yahoo Finance chart API', timestamp: new Date().toISOString(), data })
}
