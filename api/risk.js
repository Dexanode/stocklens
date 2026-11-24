export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' })
  if (!process.env.VIKEY_API_KEY) return response.status(503).json({ error: 'Vikey is not configured yet. Add VIKEY_API_KEY in Vercel.' })

  try {
    const input = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
    const asset = input?.asset
    if (!asset?.symbol) return response.status(400).json({ error: 'Asset payload is required' })
    const upstream = await fetch('https://api-plan.vikey.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.VIKEY_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'vikey/plan',
        max_tokens: 900,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: 'You are StockLens Research AI. Return only valid JSON with exactly these keys: summary (string), bull (string), bear (string), risk (one of Low, Moderate, Elevated, High), score (integer 0-100), confidence (integer 0-100), catalysts (array of 2 concise strings), risks (array of 2 concise strings), portfolioRationale (string). Ground the brief only in the supplied market fields. Never invent news, fundamentals, ownership, or live events. This is educational research, not financial advice.' }, { role: 'user', content: JSON.stringify(asset) }],
      }),
    })
    if (!upstream.ok) return response.status(upstream.status).json({ error: `Vikey request failed (${upstream.status})` })
    const payload = await upstream.json()
    const content = payload.choices?.[0]?.message?.content
    const result = typeof content === 'string' ? JSON.parse(content) : content
    response.status(200).json(result)
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Unable to parse Vikey response' })
  }
}
