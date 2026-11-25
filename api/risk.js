export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' })
  if (!process.env.VIKEY_API_KEY) return response.status(503).json({ error: 'Vikey is not configured yet. Add VIKEY_API_KEY in Vercel.' })

  try {
    const input = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
    const asset = input?.asset
    if (!asset?.symbol || !asset?.price || !asset?.change) {
      return response.status(400).json({ error: 'Asset payload requires symbol, price, and change' })
    }
    const compactAsset = {
      symbol: String(asset.symbol).slice(0, 24),
      name: String(asset.name || asset.symbol).slice(0, 80),
      sector: String(asset.sector || 'Tokenized equity').slice(0, 80),
      price: String(asset.price).slice(0, 32),
      change: String(asset.change).slice(0, 32),
      risk: String(asset.risk || 'Moderate').slice(0, 24),
      score: Number.isFinite(Number(asset.score)) ? Number(asset.score) : 50,
      volume: String(asset.volume || 'Unavailable').slice(0, 32),
    }
    const upstream = await fetch('https://api-plan.vikey.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.VIKEY_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'vikey/plan',
        max_tokens: 900,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: 'You are StockLens Research AI. Return only valid JSON with exactly these keys: summary (string), bull (string), bear (string), risk (one of Low, Moderate, Elevated, High), score (integer 0-100), confidence (integer 0-100), catalysts (array of 2 concise strings), risks (array of 2 concise strings), portfolioRationale (string). Ground the brief only in the supplied market fields. Never invent news, fundamentals, ownership, or live events. This is educational research, not financial advice.' }, { role: 'user', content: JSON.stringify(compactAsset) }],
      }),
    })
    if (!upstream.ok) {
      const detail = await upstream.text()
      return response.status(502).json({ error: `Vikey request failed (${upstream.status})`, detail: detail.slice(0, 240) })
    }
    const payload = await upstream.json()
    const content = payload.choices?.[0]?.message?.content
    const result = typeof content === 'string' ? JSON.parse(content) : content
    if (!result?.summary || !result?.bull || !result?.bear || !Array.isArray(result?.catalysts) || !Array.isArray(result?.risks)) {
      return response.status(502).json({ error: 'Vikey returned incomplete research JSON' })
    }
    response.status(200).json(result)
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Unable to parse Vikey response' })
  }
}
