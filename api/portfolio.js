export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' })
  if (!process.env.VIKEY_API_KEY) return response.status(503).json({ error: 'Vikey is not configured yet. Add VIKEY_API_KEY in Vercel.' })

  try {
    const input = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
    const universe = Array.isArray(input?.universe) ? input.universe.slice(0, 8) : []
    const holdings = Array.isArray(input?.holdings) ? input.holdings.slice(0, 12) : []
    if (!universe.length) return response.status(400).json({ error: 'Portfolio payload requires a B20 asset universe' })

    const compactUniverse = universe.map((asset) => ({
      symbol: String(asset.symbol || '').slice(0, 24),
      name: String(asset.name || asset.symbol || '').slice(0, 80),
      risk: String(asset.risk || 'Moderate').slice(0, 24),
      score: Number.isFinite(Number(asset.score)) ? Number(asset.score) : 50,
      price: String(asset.price || '—').slice(0, 32),
      change: String(asset.change || '—').slice(0, 32),
      volume: String(asset.volume || 'B20 NAV reference').slice(0, 32),
      contractAddress: String(asset.contractAddress || '').slice(0, 50),
    }))
    const compactHoldings = holdings.map((item) => ({
      symbol: String(item.symbol || '').slice(0, 24),
      units: Number.isFinite(Number(item.units)) ? Number(item.units) : 0,
      notional: Number.isFinite(Number(item.notional)) ? Number(item.notional) : 0,
    }))

    const upstream = await fetch('https://api-plan.vikey.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.VIKEY_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'vikey/plan',
        max_tokens: 1100,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are StockLens Portfolio Agent. Return only valid JSON with exactly these keys: summary (string), regime (one of Defensive, Balanced, Opportunistic), allocations (array of exactly 4 objects with symbol, targetPercent integer 0-100, reason string), actions (array of 2 concise strings), rebalanceNote (string), confidence (integer 0-100). Use only the supplied B20 NAV/reference fields and current paper holdings. Target percentages must sum to 100. Keep this educational and paper-only: never recommend live execution, leverage, custody, or guaranteed returns. If holdings are empty, describe a starter allocation. Do not invent news, fundamentals, ownership, or liquidity beyond the supplied fields.'
          },
          { role: 'user', content: JSON.stringify({ universe: compactUniverse, currentPaperHoldings: compactHoldings }) },
        ],
      }),
    })
    if (!upstream.ok) {
      const detail = await upstream.text()
      return response.status(502).json({ error: `Vikey request failed (${upstream.status})`, detail: detail.slice(0, 240) })
    }
    const payload = await upstream.json()
    const content = payload.choices?.[0]?.message?.content
    const result = typeof content === 'string' ? JSON.parse(content) : content
    const symbols = new Set(compactUniverse.map((asset) => asset.symbol))
    const allocations = Array.isArray(result?.allocations) ? result.allocations : []
    const total = allocations.reduce((sum, item) => sum + Number(item.targetPercent || 0), 0)
    if (!result?.summary || !Array.isArray(result?.actions) || allocations.length !== 4 || Math.round(total) !== 100 || allocations.some((item) => !symbols.has(item.symbol))) {
      return response.status(502).json({ error: 'Vikey returned incomplete or invalid portfolio JSON' })
    }
    response.status(200).json({ ...result, source: 'Vikey Portfolio Agent', paperOnly: true })
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Unable to parse Vikey response' })
  }
}
