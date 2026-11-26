import { isBlockedCountry } from './lib/geo.js'
import { checkRateLimit } from './lib/rate-limit.js'

// Best-effort per-IP limit (in-memory, per serverless instance — see
// api/lib/rate-limit.js). 10 req/min/IP: the Portfolio Agent is a heavy
// call, so it gets the tightest budget (audit C-2).
const RATE_LIMIT = { limit: 10, windowMs: 60_000, keyPrefix: 'portfolio' }

function fallbackPlan(universe, holdings) {
  const usable = universe.filter((asset) => asset.price !== '—' && asset.dataQuality?.nav !== false)
  const weights = usable.map((asset) => Math.max(1, Number(asset.score || 0)))
  const total = weights.reduce((sum, value) => sum + value, 0) || 1
  const raw = weights.map((weight) => (weight / total) * 100)
  const rounded = raw.map((value) => Math.floor(value))
  let remainder = 100 - rounded.reduce((sum, value) => sum + value, 0)
  raw.map((value, index) => ({ value, index })).sort((left, right) => (right.value - Math.floor(right.value)) - (left.value - Math.floor(left.value))).forEach(({ index }) => { if (remainder > 0) { rounded[index] += 1; remainder -= 1 } })
  const bySymbol = new Map(usable.map((asset, index) => [asset.symbol, rounded[index]]))
  return {
    summary: holdings.length ? 'Fallback rebalance built from live NAV quality and score because the AI response was unavailable.' : 'Starter allocation built from live NAV quality and score while the AI response is unavailable.',
    regime: 'Balanced',
    allocations: universe.map((asset) => ({ symbol: asset.symbol, targetPercent: bySymbol.get(asset.symbol) || 0, reason: bySymbol.has(asset.symbol) ? `Weighted from score ${asset.score}/100 and NAV availability.` : 'No usable NAV reference; kept at 0%.' })),
    actions: ['Review current-vs-target allocation before applying.', 'Keep all positions paper-only; no order was sent.'],
    rebalanceNote: 'Deterministic fallback; rerun the agent when Vikey is available.',
    confidence: 35,
    source: 'StockLens deterministic fallback',
    paperOnly: true,
    fallback: true,
  }
}

function historyStats(rows = []) {
  const prices = rows.map((row) => Number(row?.price)).filter((value) => Number.isFinite(value) && value > 0)
  if (prices.length < 2) return { historyCount: prices.length, historyChangePct: null, volatilityPct: null }
  const returns = prices.slice(1).map((price, index) => ((price - prices[index]) / prices[index]) * 100).filter(Number.isFinite)
  const mean = returns.reduce((sum, value) => sum + value, 0) / Math.max(returns.length, 1)
  const variance = returns.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / Math.max(returns.length, 1)
  return { historyCount: prices.length, historyChangePct: ((prices.at(-1) - prices[0]) / prices[0]) * 100, volatilityPct: returns.length >= 2 ? Math.sqrt(variance) : null }
}

function parseModelJson(content) {
  if (Array.isArray(content)) return parseModelJson(content.map((part) => part?.text || part?.content || '').join(''))
  if (content && typeof content === 'object' && (content.text || content.content)) return parseModelJson(content.text || content.content)
  if (content && typeof content === 'object') return content
  const text = String(content || '').replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Vikey returned no JSON object')
  return JSON.parse(text.slice(start, end + 1))
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' })
  // Geo-block enforced from the Vercel IP header, not the self-declared
  // client header (audit C-3). See api/lib/geo.js.
  if (isBlockedCountry(request).blocked) return response.status(451).json({ error: 'Research access is unavailable in the United States.' })
  const rate = checkRateLimit(request, RATE_LIMIT)
  response.setHeader('X-RateLimit-Remaining', String(Math.max(0, rate.remaining)))
  response.setHeader('X-RateLimit-Reset', String(Math.ceil(rate.resetAt / 1000)))
  if (rate.limited) {
    response.setHeader('Retry-After', String(rate.retryAfterSeconds))
    return response.status(429).json({ error: 'Rate limit exceeded. Try again shortly.', retryAfterSeconds: rate.retryAfterSeconds })
  }
  if (!process.env.VIKEY_API_KEY) return response.status(503).json({ error: 'Vikey is not configured yet. Add VIKEY_API_KEY in Vercel.' })

  let safeUniverse = []
  let safeHoldings = []
  try {
    const input = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
    const universe = Array.isArray(input?.universe) ? input.universe.slice(0, 24) : []
    const holdings = Array.isArray(input?.holdings) ? input.holdings.slice(0, 12) : []
    if (!universe.length) return response.status(400).json({ error: 'Portfolio payload requires a B20 asset universe' })

    // Only history *statistics* go to Vikey — historyCount, historyChangePct,
    // volatilityPct — never the raw NAV points. The frontend sends up to 260
    // points per asset, but they are reduced here before the upstream call,
    // so Vikey tokens stay proportional to the universe size, not its history
    // depth. (This corrects audit note L-10: the payload was already
    // stats-only; the remaining token cut is max_tokens below.)
    const compactUniverse = universe.map((asset) => ({
      symbol: String(asset.symbol || '').slice(0, 24),
      name: String(asset.name || asset.symbol || '').slice(0, 80),
      risk: String(asset.risk || 'Moderate').slice(0, 24),
      score: Number.isFinite(Number(asset.score)) ? Number(asset.score) : 50,
      price: String(asset.price || '—').slice(0, 32),
      change: String(asset.change || '—').slice(0, 32),
      volume: String(asset.volume || 'B20 NAV reference').slice(0, 48),
      contractAddress: String(asset.contractAddress || '').slice(0, 50),
      navUpdatedAt: String(asset.navUpdatedAt || '').slice(0, 40),
      totalSupply: Number.isFinite(Number(asset.totalSupply)) ? Number(asset.totalSupply) : null,
      multiplier: Number.isFinite(Number(asset.multiplier)) ? Number(asset.multiplier) : null,
      pausedFeatures: Array.isArray(asset.pausedFeatures) ? asset.pausedFeatures.slice(0, 6) : [],
      dataQuality: asset.dataQuality || {},
      ...historyStats(Array.isArray(asset.navHistory) ? asset.navHistory.slice(-260) : []),
      ...(typeof asset.volatility === 'number' && Number.isFinite(asset.volatility) && asset.volatility >= 0 ? { volatilityPct: asset.volatility } : {}),
    }))
    const compactHoldings = holdings.map((item) => ({
      symbol: String(item.symbol || '').slice(0, 24),
      units: Number.isFinite(Number(item.units)) ? Number(item.units) : 0,
      notional: Number.isFinite(Number(item.notional)) ? Number(item.notional) : 0,
    }))
    safeUniverse = compactUniverse
    safeHoldings = compactHoldings

    const upstream = await fetch('https://api-plan.vikey.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.VIKEY_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'vikey/plan',
        // Was 2400 + 300/asset (up to 9,600 tokens per call). The expected
        // output is one allocation line per asset plus a summary, but a
        // 13-asset run took ~13s and only succeeded once the response
        // budget was raised, so the first PR's 1800 + 100/asset cap
        // (3,100 tokens at 13 assets) risked truncated JSON -> fallback.
        // 2400 + 200/asset (5,000 at 13 assets, max 7,200 at 24) keeps a
        // real cut versus the original while leaving headroom. Per-call
        // spend stays bounded by the 10 req/min/IP rate limit (audit C-2).
        max_tokens: 2400 + 200 * compactUniverse.length,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are StockLens Portfolio Agent. Return only valid JSON with exactly these keys: summary (string), regime (one of Defensive, Balanced, Opportunistic), allocations (one object for every supplied universe symbol, each with symbol, targetPercent integer 0-100, reason string), actions (array of 2 concise strings), rebalanceNote (string), confidence (integer 0-100). Use only supplied B20 NAV/reference, supply, freshness, pause, data-quality, historyChangePct, volatilityPct and current paper holdings. Target percentages must sum to 100 and must not be equal by default: weight assets using score, momentum, volatility and data quality, give 0% to assets without a usable NAV, and explain missing history. Keep this educational and paper-only: never recommend live execution, leverage, custody, or guaranteed returns. If holdings are empty, describe a starter allocation. Do not invent news, fundamentals, ownership, or liquidity.'
          },
          { role: 'user', content: JSON.stringify({ universe: compactUniverse, currentPaperHoldings: compactHoldings }) },
        ],
      }),
      // Bound the upstream call so a slow Vikey cannot hang the function
      // into a Vercel timeout (audit C-2). 25s, not 8s: a 13-asset run
      // took ~13s end-to-end, so the original 8s cap would have forced
      // the deterministic fallback on most real runs. vercel.json allows
      // 30s for this route, so 25s leaves room for parsing and return.
      // If the Vercel plan caps maxDuration at 10s (Hobby), the function
      // itself is killed at 10s regardless — the 13s success implies the
      // current deploy allows more; verify on the preview deploy.
      signal: AbortSignal.timeout(25000),
    })
    if (!upstream.ok) {
      const detail = await upstream.text()
      return response.status(200).json(fallbackPlan(compactUniverse, compactHoldings))
    }
    const payload = await upstream.json()
    const content = payload.choices?.[0]?.message?.content
    const result = parseModelJson(content)
    const symbols = new Set(compactUniverse.map((asset) => asset.symbol))
    const allocations = Array.isArray(result?.allocations) ? result.allocations : []
    const total = allocations.reduce((sum, item) => sum + Number(item.targetPercent || 0), 0)
    if (!result?.summary || !Array.isArray(result?.actions) || allocations.length !== compactUniverse.length || Math.round(total) !== 100 || allocations.some((item) => !symbols.has(item.symbol))) {
      return response.status(200).json(fallbackPlan(compactUniverse, compactHoldings))
    }
    const confidenceMap = { low: 35, medium: 60, high: 80 }
    const rawConfidence = Number(result.confidence)
    const confidence = Number.isFinite(rawConfidence) ? Math.round(Math.max(0, Math.min(100, rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence))) : (confidenceMap[String(result.confidence || '').toLowerCase()] || 50)
    const normalizedAllocations = allocations.map((item) => ({
      ...item,
      targetPercent: Math.max(0, Math.min(100, Math.round(Number(item.targetPercent) || 0))),
      reason: String(item.reason || 'AI-weighted from supplied NAV history and data quality.').slice(0, 180),
    }))
    response.status(200).json({ ...result, allocations: normalizedAllocations, confidence, source: 'Vikey Portfolio Agent', paperOnly: true, fallback: false })
  } catch (error) {
    // If validation never produced a universe (empty/malformed payload), do
    // not answer with an empty 200 "plan" — that bypassed the 400 above
    // (audit M-10).
    if (!safeUniverse.length) return response.status(400).json({ error: 'Portfolio payload requires a B20 asset universe' })
    response.status(200).json(fallbackPlan(safeUniverse, safeHoldings))
  }
}
